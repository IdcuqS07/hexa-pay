export enum QuoteStatus {
  None = 0,
  Pending = 1,
  Settled = 2,
  Cancelled = 3,
  Expired = 4,
}

export type QuoteView = {
  merchant: string;
  payer: string;
  expiresAt: number;
  status: QuoteStatus;
  accessGranted: boolean;
};

export const QUOTE_STATUS_LABEL: Record<number, string> = {
  0: "None",
  1: "Pending",
  2: "Settled",
  3: "Cancelled",
  4: "Expired",
};
