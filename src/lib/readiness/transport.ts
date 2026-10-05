import { requireRole } from "@/lib/api";
import { domainHandler } from "@/lib/domain-api";
import { checkProfileActor } from "@/lib/organizations/context";
import { ReadinessError } from "./contracts";
import { getPublicationReadiness } from "./index";

export const loadPublicationReadiness = domainHandler(async (request: Request) => {
  const actor = await requireRole("CREATOR", "BRAND");
  await checkProfileActor(actor);
  const entries = [...new URL(request.url).searchParams];
  if (new Set(entries.map(([key]) => key)).size !== entries.length
    || entries.some(([key]) => !["portfolioVersion", "visibleAccountIds"].includes(key))) throw new ReadinessError("VALIDATION", 422);
  const values = Object.fromEntries(entries);
  if (values.portfolioVersion !== undefined && !/^[1-9][0-9]{0,15}$/.test(values.portfolioVersion)) throw new ReadinessError("VALIDATION", 422);
  let visibleAccountIds: unknown;
  if (values.visibleAccountIds !== undefined) {
    if (values.visibleAccountIds.length > 65536) throw new ReadinessError("VALIDATION", 422);
    try { visibleAccountIds = JSON.parse(values.visibleAccountIds); } catch { throw new ReadinessError("VALIDATION", 422); }
  }
  return getPublicationReadiness(actor, { ...(values.portfolioVersion === undefined ? {} : { portfolioVersion: Number(values.portfolioVersion) }),
    ...(values.visibleAccountIds === undefined ? {} : { visibleAccountIds }) });
});
