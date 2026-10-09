/** Lingxing product daily grain. Never combined with campaign-level ad records. */
export interface ProductPerformanceRecord {
  key: string;
  date: string;
  asin: string;
  scope: "parent" | "asin";
  marketplace?: "US";
  productName?: string;
  sourceFilename?: string;
  units?: number;
  sales?: number;
  grossProfit?: number;
  spend?: number;
  adSales?: number;
  adOrders?: number;
  adUnits?: number;
  clicks?: number;
  impressions?: number;
  sessions?: number;
  price?: number;
  fbaAvailable?: number;
  rating?: number;
  reviews?: number;
  categoryRank?: string;
  subcategoryRank?: string;
  adOperations?: string;
  listingOperations?: string;
}
