export interface GraphNode {
  id: string;
  type: EntityType;
  label: string;
  metadata: Record<string, unknown>;
  val?: number; // node size
}

export interface GraphLink {
  source: string;
  target: string;
  relationship: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export type EntityType =
  | 'SalesOrder'
  | 'SalesOrderItem'
  | 'Delivery'
  | 'DeliveryItem'
  | 'BillingDocument'
  | 'BillingDocumentItem'
  | 'JournalEntry'
  | 'Payment'
  | 'BusinessPartner'
  | 'Product'
  | 'Plant';

export const ENTITY_COLORS: Record<EntityType, string> = {
  SalesOrder: '#3B82F6',
  SalesOrderItem: '#60A5FA',
  Delivery: '#10B981',
  DeliveryItem: '#34D399',
  BillingDocument: '#F59E0B',
  BillingDocumentItem: '#FBBF24',
  JournalEntry: '#8B5CF6',
  Payment: '#EF4444',
  BusinessPartner: '#6B7280',
  Product: '#14B8A6',
  Plant: '#92400E',
};

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  data?: Record<string, unknown>[];
  highlightedNodes?: string[];
  timestamp: number;
}

export interface ChatResponse {
  answer: string;
  sql?: string;
  data?: Record<string, unknown>[];
  highlightedNodes?: string[];
}
