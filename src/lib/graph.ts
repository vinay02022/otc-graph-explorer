import { getDb } from './db';
import type { GraphNode, GraphLink, GraphData, EntityType } from '@/types';

interface RawRow {
  [key: string]: string | null;
}

async function queryAll(sql: string): Promise<RawRow[]> {
  const db = await getDb();
  const result = db.exec(sql);
  if (result.length === 0) return [];
  const { columns, values } = result[0];
  return values.map((row: unknown[]) => {
    const obj: RawRow = {};
    columns.forEach((col: string, i: number) => { obj[col] = row[i] as string | null; });
    return obj;
  });
}

function makeNode(id: string, type: EntityType, label: string, metadata: Record<string, unknown>): GraphNode {
  return { id, type, label, metadata, val: 1 };
}

// Normalize item numbers: "000010" -> "10", "10" -> "10"
function normalizeItemNum(val: string | null): string {
  if (!val) return '';
  return String(parseInt(val, 10));
}

export async function buildGraph(): Promise<GraphData> {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeIds = new Set<string>();

  function addNode(node: GraphNode) {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  }

  // 1. Sales Order Headers
  const salesOrders = await queryAll('SELECT * FROM sales_order_headers');
  for (const so of salesOrders) {
    addNode(makeNode(
      `SO:${so.salesOrder}`,
      'SalesOrder',
      `SO ${so.salesOrder}`,
      so
    ));
  }

  // 2. Sales Order Items
  const salesOrderItems = await queryAll('SELECT * FROM sales_order_items');
  for (const soi of salesOrderItems) {
    const id = `SOI:${soi.salesOrder}_${soi.salesOrderItem}`;
    addNode(makeNode(id, 'SalesOrderItem', `Item ${soi.salesOrderItem}`, soi));

    // Edge: SalesOrder -> SalesOrderItem
    links.push({ source: `SO:${soi.salesOrder}`, target: id, relationship: 'HAS_ITEM' });

    // Edge: SalesOrderItem -> Product
    if (soi.material) {
      links.push({ source: id, target: `PRD:${soi.material}`, relationship: 'CONTAINS_PRODUCT' });
    }
  }

  // 3. Outbound Delivery Headers
  const deliveries = await queryAll('SELECT * FROM outbound_delivery_headers');
  for (const d of deliveries) {
    addNode(makeNode(
      `DEL:${d.deliveryDocument}`,
      'Delivery',
      `Del ${d.deliveryDocument}`,
      d
    ));
  }

  // 4. Outbound Delivery Items
  const deliveryItems = await queryAll('SELECT * FROM outbound_delivery_items');
  for (const di of deliveryItems) {
    const id = `DI:${di.deliveryDocument}_${di.deliveryDocumentItem}`;
    addNode(makeNode(id, 'DeliveryItem', `DI ${di.deliveryDocumentItem}`, di));

    // Edge: DeliveryItem -> Delivery
    links.push({ source: id, target: `DEL:${di.deliveryDocument}`, relationship: 'BELONGS_TO' });

    // Edge: SalesOrderItem -> DeliveryItem (via referenceSdDocument)
    // Delivery items use "000010" format, sales order items use "10" format
    if (di.referenceSdDocument && di.referenceSdDocumentItem) {
      const normalizedItem = normalizeItemNum(di.referenceSdDocumentItem);
      const soiId = `SOI:${di.referenceSdDocument}_${normalizedItem}`;
      links.push({ source: soiId, target: id, relationship: 'FULFILLED_BY' });
    }

    // Edge: DeliveryItem -> Plant
    if (di.plant) {
      links.push({ source: id, target: `PLT:${di.plant}`, relationship: 'SHIPPED_FROM' });
    }
  }

  // 5. Billing Document Headers
  const billingDocs = await queryAll('SELECT * FROM billing_document_headers');
  for (const bd of billingDocs) {
    addNode(makeNode(
      `BD:${bd.billingDocument}`,
      'BillingDocument',
      `Bill ${bd.billingDocument}`,
      bd
    ));
  }

  // 6. Billing Document Items
  const billingItems = await queryAll('SELECT * FROM billing_document_items');
  for (const bi of billingItems) {
    const id = `BDI:${bi.billingDocument}_${bi.billingDocumentItem}`;
    addNode(makeNode(id, 'BillingDocumentItem', `BI ${bi.billingDocumentItem}`, bi));

    // Edge: BillingDocumentItem -> BillingDocument
    links.push({ source: id, target: `BD:${bi.billingDocument}`, relationship: 'BELONGS_TO' });

    // Edge: DeliveryItem -> BillingDocumentItem (via referenceSdDocument = deliveryDocument)
    // Billing items referenceSdDocumentItem uses "10" format, delivery items use "000010"
    if (bi.referenceSdDocument && bi.referenceSdDocumentItem) {
      const paddedItem = String(bi.referenceSdDocumentItem).padStart(6, '0');
      const diId = `DI:${bi.referenceSdDocument}_${paddedItem}`;
      links.push({ source: diId, target: id, relationship: 'BILLED_IN' });
    }

    // Edge: BillingDocumentItem -> Product
    if (bi.material) {
      links.push({ source: id, target: `PRD:${bi.material}`, relationship: 'FOR_PRODUCT' });
    }
  }

  // 7. Journal Entry Items
  const journalEntries = await queryAll('SELECT * FROM journal_entry_items_accounts_receivable');
  // Group by accountingDocument to create unique journal entry nodes
  const jeMap = new Map<string, RawRow>();
  for (const je of journalEntries) {
    const key = `${je.accountingDocument}`;
    if (!jeMap.has(key)) {
      jeMap.set(key, je);
    }
  }
  for (const [key, je] of jeMap) {
    const id = `JE:${key}`;
    addNode(makeNode(id, 'JournalEntry', `JE ${key}`, je));

    // Edge: BillingDocument -> JournalEntry (via referenceDocument = billingDocument)
    if (je.referenceDocument) {
      links.push({ source: `BD:${je.referenceDocument}`, target: id, relationship: 'GENERATES' });
    }
  }

  // 8. Payments
  const payments = await queryAll('SELECT * FROM payments_accounts_receivable');
  const payMap = new Map<string, RawRow>();
  for (const p of payments) {
    const key = `${p.clearingAccountingDocument}`;
    if (key && key !== 'null' && !payMap.has(key)) {
      payMap.set(key, p);
    }
  }
  for (const [key, p] of payMap) {
    const id = `PAY:${key}`;
    addNode(makeNode(id, 'Payment', `Pay ${key}`, p));

    // Edge: JournalEntry -> Payment (via clearingAccountingDocument)
    if (p.accountingDocument) {
      links.push({ source: `JE:${p.accountingDocument}`, target: id, relationship: 'CLEARED_BY' });
    }
  }

  // 9. Business Partners (Customers)
  const partners = await queryAll('SELECT * FROM business_partners');
  for (const bp of partners) {
    addNode(makeNode(
      `BP:${bp.customer}`,
      'BusinessPartner',
      bp.businessPartnerName || `BP ${bp.customer}`,
      bp
    ));
  }

  // Edge: SalesOrder -> BusinessPartner (via soldToParty = customer)
  for (const so of salesOrders) {
    if (so.soldToParty) {
      links.push({ source: `SO:${so.salesOrder}`, target: `BP:${so.soldToParty}`, relationship: 'SOLD_TO' });
    }
  }

  // 10. Products
  const products = await queryAll(`
    SELECT p.*, pd.productDescription
    FROM products p
    LEFT JOIN product_descriptions pd ON p.product = pd.product
  `);
  for (const p of products) {
    addNode(makeNode(
      `PRD:${p.product}`,
      'Product',
      p.productDescription || `Product ${p.product}`,
      p
    ));
  }

  // 11. Plants
  const plants = await queryAll('SELECT * FROM plants');
  for (const pl of plants) {
    addNode(makeNode(
      `PLT:${pl.plant}`,
      'Plant',
      pl.plantName || `Plant ${pl.plant}`,
      pl
    ));
  }

  // Filter out links where source or target node doesn't exist
  const validLinks = links.filter(l => nodeIds.has(l.source) && nodeIds.has(l.target));

  // Update node val (size) based on connection count
  const connectionCount = new Map<string, number>();
  for (const link of validLinks) {
    connectionCount.set(link.source, (connectionCount.get(link.source) || 0) + 1);
    connectionCount.set(link.target, (connectionCount.get(link.target) || 0) + 1);
  }
  for (const node of nodes) {
    node.val = Math.max(1, Math.min(10, (connectionCount.get(node.id) || 0)));
  }

  return { nodes, links: validLinks };
}

export function getNodeWithNeighbors(nodeId: string, graphData: GraphData): GraphData {
  const neighborIds = new Set<string>();
  neighborIds.add(nodeId);

  const relevantLinks = graphData.links.filter(l => {
    const src = typeof l.source === 'string' ? l.source : (l.source as unknown as GraphNode).id;
    const tgt = typeof l.target === 'string' ? l.target : (l.target as unknown as GraphNode).id;
    if (src === nodeId) { neighborIds.add(tgt); return true; }
    if (tgt === nodeId) { neighborIds.add(src); return true; }
    return false;
  });

  const relevantNodes = graphData.nodes.filter(n => neighborIds.has(n.id));
  return { nodes: relevantNodes, links: relevantLinks };
}

// Cache the graph in memory
let cachedGraph: GraphData | null = null;
let graphPromise: Promise<GraphData> | null = null;

export async function getGraph(): Promise<GraphData> {
  if (cachedGraph) return cachedGraph;
  if (!graphPromise) {
    graphPromise = buildGraph().then(g => { cachedGraph = g; return g; });
  }
  return graphPromise;
}
