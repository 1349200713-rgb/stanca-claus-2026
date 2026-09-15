export type SizeCode = "L" | "XL" | "2XL" | "3XL";

export type Status = "complete" | "attention" | "risk";

export interface PlanRow {
  date: string;
  size: SizeCode;
  plannedUnits: number;
  targetPrice: number;
  targetMargin: number;
  targetAcos: number;
  unitProductCost: number;
  unitInboundCost: number;
  unitFbaFee: number;
  commissionRate: number;
}

export interface BusinessRecord {
  key: string;
  date: string;
  asin: string;
  sku: string;
  size: SizeCode;
  units: number;
  sales: number;
  refunds?: number;
  discounts?: number;
  fbaAvailable?: number;
  reserved?: number;
  unfulfillable?: number;
}

export interface AdRecord {
  key: string;
  date: string;
  campaign: string;
  spend: number;
  adSales: number;
  adOrders: number;
  clicks?: number;
  impressions?: number;
  cpc?: number;
  ctr?: number;
  cvr?: number;
}

export interface ManualRecord {
  date: string;
  size: SizeCode;
  inbound?: number;
  inboundObserved?: boolean;
  inventoryAdjustment?: number;
  event?: string;
  issue?: string;
  action?: string;
  actionComplete: boolean;
}

export interface MetricSnapshot {
  plannedUnits: number;
  actualUnits: number | null;
  unitVariance: number | null;
  completionRate: number | null;
  sales: number | null;
  plannedSales: number;
  salesVariance: number | null;
  averagePrice: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  adSpend: number | null;
  adSales: number | null;
  acos: number | null;
  availableInventory: number | null;
  projectedEndingInventory: number | null;
  overstockRate: number | null;
  daysToStockout: number | null;
  last7DayAverageUnits: number | null;
}

export interface RiskSignal {
  id: string;
  label: string;
  status: Status;
  detail: string;
}
