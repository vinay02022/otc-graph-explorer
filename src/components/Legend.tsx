'use client';

import { ENTITY_COLORS, type EntityType } from '@/types';

const ENTITY_LABELS: Record<EntityType, string> = {
  SalesOrder: 'Sales Order',
  SalesOrderItem: 'SO Item',
  Delivery: 'Delivery',
  DeliveryItem: 'Delivery Item',
  BillingDocument: 'Billing Doc',
  BillingDocumentItem: 'Billing Item',
  JournalEntry: 'Journal Entry',
  Payment: 'Payment',
  BusinessPartner: 'Customer',
  Product: 'Product',
  Plant: 'Plant',
};

interface LegendProps {
  visibleTypes: Set<EntityType>;
  onToggleType: (type: EntityType) => void;
}

export default function Legend({ visibleTypes, onToggleType }: LegendProps) {
  return (
    <div className="absolute top-14 left-4 bg-white/95 backdrop-blur rounded-lg shadow-md border border-gray-200 p-3 z-10">
      <div className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Entity Types</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {(Object.entries(ENTITY_COLORS) as [EntityType, string][]).map(([type, color]) => (
          <button
            key={type}
            onClick={() => onToggleType(type)}
            className={`flex items-center gap-1.5 text-xs py-0.5 transition-opacity ${
              visibleTypes.has(type) ? 'opacity-100' : 'opacity-30'
            }`}
          >
            <span
              className="w-3 h-3 rounded-full inline-block shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="text-gray-700">{ENTITY_LABELS[type]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
