'use client';

import { ENTITY_COLORS, type GraphNode } from '@/types';

interface NodeInspectorProps {
  node: GraphNode;
  onClose: () => void;
  position: { x: number; y: number };
}

export default function NodeInspector({ node, onClose, position }: NodeInspectorProps) {
  const color = ENTITY_COLORS[node.type];

  // Key fields to show prominently, rest hidden by default
  const keyFields: Record<string, string[]> = {
    SalesOrder: ['salesOrder', 'soldToParty', 'totalNetAmount', 'transactionCurrency', 'creationDate', 'overallDeliveryStatus'],
    SalesOrderItem: ['salesOrder', 'salesOrderItem', 'material', 'requestedQuantity', 'netAmount'],
    Delivery: ['deliveryDocument', 'creationDate', 'overallGoodsMovementStatus', 'overallPickingStatus'],
    DeliveryItem: ['deliveryDocument', 'deliveryDocumentItem', 'referenceSdDocument', 'actualDeliveryQuantity', 'plant'],
    BillingDocument: ['billingDocument', 'billingDocumentType', 'totalNetAmount', 'soldToParty', 'accountingDocument', 'billingDocumentIsCancelled'],
    BillingDocumentItem: ['billingDocument', 'billingDocumentItem', 'material', 'billingQuantity', 'netAmount', 'referenceSdDocument'],
    JournalEntry: ['accountingDocument', 'referenceDocument', 'glAccount', 'amountInTransactionCurrency', 'postingDate', 'customer'],
    Payment: ['clearingAccountingDocument', 'accountingDocument', 'amountInTransactionCurrency', 'customer', 'postingDate'],
    BusinessPartner: ['customer', 'businessPartnerFullName', 'businessPartnerGrouping', 'creationDate'],
    Product: ['product', 'productDescription', 'productType', 'productGroup', 'baseUnit', 'grossWeight'],
    Plant: ['plant', 'plantName', 'salesOrganization'],
  };

  const primaryFields = keyFields[node.type] || [];
  const allFields = Object.entries(node.metadata).filter(([, v]) => v !== null && v !== '' && v !== undefined);
  const shownFields = allFields.filter(([k]) => primaryFields.includes(k));
  const hiddenFields = allFields.filter(([k]) => !primaryFields.includes(k));

  const connections = node.val || 0;

  return (
    <div
      className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 p-4 min-w-[320px] max-w-[400px] max-h-[500px] overflow-y-auto"
      style={{
        left: Math.min(position.x + 10, window.innerWidth - 420),
        top: Math.min(Math.max(position.y - 10, 50), window.innerHeight - 520),
      }}
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="font-bold text-lg text-gray-900">{node.type}</h3>
          <div className="text-xs font-medium mt-0.5" style={{ color }}>
            Entity: {node.type}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xl leading-none"
        >
          x
        </button>
      </div>

      <div className="space-y-1.5">
        {shownFields.map(([key, value]) => (
          <div key={key} className="flex text-sm">
            <span className="font-semibold text-gray-700 min-w-[140px] shrink-0">{key}:</span>
            <span className="text-gray-600 break-all">{String(value)}</span>
          </div>
        ))}
      </div>

      {hiddenFields.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
            Additional fields hidden for readability ({hiddenFields.length} more)
          </summary>
          <div className="space-y-1.5 mt-2">
            {hiddenFields.map(([key, value]) => (
              <div key={key} className="flex text-sm">
                <span className="font-semibold text-gray-700 min-w-[140px] shrink-0">{key}:</span>
                <span className="text-gray-600 break-all">{String(value)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="mt-3 pt-2 border-t border-gray-100 text-xs text-gray-500">
        Connections: {connections}
      </div>
    </div>
  );
}
