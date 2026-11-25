export function calculateExpectedShiftCash(openingCashMinor: number, cashSalesMinor: number, cashRefundMinor: number, paidInMinor: number, paidOutMinor: number): number {
  return openingCashMinor + cashSalesMinor - cashRefundMinor + paidInMinor - paidOutMinor;
}
