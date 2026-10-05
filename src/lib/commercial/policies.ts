import { z } from "zod";
import { addMoney, MoneySchema, type Money } from "@/lib/contracts/money";
import { bandForFollowers, CancellationScheduleSchema, CancellationStageSchema, COMMERCIAL_LIMITS, DirectCostsSchema, TaxTreatmentSchema, type ReachBand } from "./contracts";

export function assessForecast(netInput: Money, costsInput: unknown) {
  const net = MoneySchema.parse(netInput), costs = DirectCostsSchema.parse(costsInput);
  const directCost = Object.values(costs).reduce((sum, cost) => addMoney(sum, cost), { amountMinor: "0", currencyCode: net.currencyCode });
  const revenue = BigInt(net.amountMinor), contribution = revenue - BigInt(directCost.amountMinor);
  return { directCost, contributionMinor: contribution.toString(),
    targetMet: revenue > BigInt("0") && contribution * BigInt("10000") >= revenue * BigInt(COMMERCIAL_LIMITS.targetMarginBasisPoints),
    commitmentAllowed: revenue > BigInt("0") && contribution * BigInt("10000") >= revenue * BigInt(COMMERCIAL_LIMITS.commitmentFloorBasisPoints) };
}
export function priceForMargin(costInput: Money, marginBasisPoints: number = COMMERCIAL_LIMITS.targetMarginBasisPoints): Money {
  const cost = MoneySchema.parse(costInput), margin = z.number().int().min(0).max(9999).parse(marginBasisPoints);
  const numerator = BigInt(cost.amountMinor) * BigInt("10000"), denominator = BigInt(10000 - margin);
  return MoneySchema.parse({ amountMinor: ((numerator + denominator - BigInt("1")) / denominator).toString(), currencyCode: cost.currencyCode });
}
export function totalWithTax(netInput: Money, treatmentInput: unknown) {
  const net = MoneySchema.parse(netInput), treatment = TaxTreatmentSchema.parse(treatmentInput);
  // Explicit policy: round a positive tax subtotal half up to the currency's minor unit.
  // Repeated refunds will use the recorded immutable tax allocation, not re-tax each request.
  const tax = MoneySchema.parse({ amountMinor: ((BigInt(net.amountMinor) * BigInt(treatment.rateBasisPoints) + BigInt("5000")) / BigInt("10000")).toString(), currencyCode: net.currencyCode });
  return { net, tax, gross: addMoney(net, tax), treatment };
}
export function cancellationLiability(input: unknown, stageInput: string): Money {
  const schedule = CancellationScheduleSchema.parse(input), stage = CancellationStageSchema.parse(stageInput);
  return schedule.stages[stage];
}
export function reachBand(followers: string | null): ReachBand | null {
  const parsed = MoneySchema.shape.amountMinor.nullable().parse(followers);
  return bandForFollowers(parsed === null ? null : BigInt(parsed));
}
