import { describe, expect, it } from "vitest";
import { aggregateAudience, budgetFit, calculateFit, evaluateCreator, nicheFit, prepareEligibility, quoteBasket, shortlist } from "../../src/lib/matching/index";
import type { AudienceAgeBucket, Bucket, CampaignInput, CreatorInput, Evidence, Fact, MatchingAccount } from "../../src/lib/matching/types";

const now = "2026-10-01T00:00:00.000Z";
const period = { startsAt: "2026-10-10T00:00:00.000Z", endsAt: "2026-10-20T00:00:00.000Z", timeZone: "Asia/Riyadh" };
const measuredWindow = { ...period, startsAt: "2026-09-01T00:00:00.000Z", endsAt: now };
function evidence(source: Evidence["source"] = "API", overrides: Partial<Evidence> = {}): Evidence {
  return { source, evidenceAt: now, reviewStatus: "APPROVED", visibility: "BRAND_ONLY", version: "e1", ...overrides };
}
function fact<T>(value: T, source: Evidence["source"] = "API"): Fact<T> { return { value, evidence: evidence(source) }; }
function account(overrides: Partial<MatchingAccount> = {}): MatchingAccount {
  return { id: "a1", platform: "INSTAGRAM", ownershipStatus: "VERIFIED", approved: true, visibility: "BRAND_ONLY", evidence: evidence(), supportedFormats: ["REEL", "STORY"], followers: fact(10000), engagementPct: fact(3.2), engagementContext:{unit:"PERCENT",window:measuredWindow,definition:"engagements / followers"}, averageViews: [{ format: "REEL", value: fact(10000), unit:"IMPRESSIONS", window: measuredWindow, definition: "mean impressions per reel" }], audience: { age: fact([{ key: "18-24", percent: 100 }]), gender: fact([{ key: "FEMALE", percent: 100 }]), countries: fact([{ key: "SA", percent: 100 }]), cities: fact([{ key: "SA:riyadh", percent: 100 }]) }, ...overrides };
}
function creator(overrides: Partial<CreatorInput> = {}): CreatorInput {
  return { id: "creator-a", claimStatus: "CLAIMED", hidden: false, suspended: false, isTest: false, eligible: true, brandVisible: true, residenceCountryCode: "GB", contentLanguages: ["ar"], dialects: ["ar-Gulf"], availability: { status: "AVAILABLE", period, confirmedAt: now }, travelWilling: false, travelCountryCodes: [], nicheSlugs: fact(["beauty"]), fameIndustries: null, accounts: [account()], rates: [{ creatorId: "creator-a", platform: "INSTAGRAM", format: "REEL", amount: { amountMinor: "10000", currencyCode: "SAR" } }], minimumDeal: null, licences: [], policyOutcomes: [], safetyExclusions: [], ...overrides };
}
function campaign(overrides: Partial<CampaignInput> = {}): CampaignInput {
  return { id: "campaign", briefVersion: 1, approved: true, budget: { amountMinor: "10000", currencyCode: "SAR" }, desiredCreatorCount: 1, allocationOrdinal: 0, impressionsTarget: 10000, period, deliverables: [{ platform: "INSTAGRAM", format: "REEL", count: 1 }], targetAgeBuckets: ["18-24"], targetGenders: ["FEMALE"], targetCountryCodes: ["SA"], targetCityKeys: ["SA:riyadh"], contentLanguages: ["ar"], dialects: ["ar-Gulf"], nicheSlugs: ["beauty"], marketCountryCodes: ["SA"], physicalPresenceRequired: false, presenceCountryCodes: [], travelAllowed: false, preferredTiers: [], dataVerificationRequired: false, preferredLicencePolicyIds: [], mandatoryPolicyVersionIds: [], noGoTopics: [], ...overrides };
}

describe("confidence-floor fit, never padded", () => {
  it("shares the contributing-source verification gate without computing a match score", () => {
    const required=campaign({dataVerificationRequired:true});
    expect(prepareEligibility(required,creator(),now).eligibility.eligible).toBe(true);
    const corrected=creator({accounts:[account({audience:{...account().audience,age:fact([{key:"18-24",percent:100}],"SELF_REPORTED")}})]});
    expect(prepareEligibility(required,corrected,now).eligibility.exclusions).toEqual(["VERIFIED_DATA_REQUIRED"]);
    expect(evaluateCreator(required,corrected,now).exclusions).toEqual(["VERIFIED_DATA_REQUIRED"]);
    const unused=creator({nicheSlugs:fact(["beauty"],"SELF_REPORTED")});
    const unscored=prepareEligibility(campaign({dataVerificationRequired:true,nicheSlugs:[]}),unused,now);
    expect(unscored.eligibility.eligible).toBe(true);
    expect(Object.hasOwn(unscored.prepared!,"score")).toBe(false);
    expect(Object.hasOwn(unscored.prepared!,"rawConfidence")).toBe(false);
    expect(Object.hasOwn(unscored.eligibility,"match")).toBe(false);
  });
  it.each([[1,100],[0.7,85],[0.4,70]])("applies confidence %s exactly once", (confidence, score) => {
    expect(calculateFit({ age:1,niche:1,geography:1,gender:1,engagement:1,budget:1,exposure:1 }, confidence)).toEqual({ weightedFit:1, score });
  });
  it("keeps unknowns null while substituting .5 once", () => {
    const allUnknown = { age:null,niche:null,geography:null,gender:null,engagement:null,budget:null,exposure:null };
    expect(calculateFit(allUnknown,1)).toEqual({ weightedFit:0.5,score:50 });
    expect(shortlist(campaign(), [creator({ nicheSlugs:null, accounts:[account({ followers:null, engagementPct:null, averageViews:[], audience:{ age:null,gender:null,countries:null,cities:null } })], rates:[] })], now)).toEqual([]);
    expect(allUnknown.age).toBeNull();
  });
  it("returns empty instead of fallback and uses ASCII ID tie with max12", () => {
    expect(shortlist(campaign(), [], now)).toEqual([]);
    const creators = Array.from({length:14},(_,i) => creator({id:`id-${String(i).padStart(2,"0")}`,rates:[{creatorId:`id-${String(i).padStart(2,"0")}`,platform:"INSTAGRAM",format:"REEL",amount:{amountMinor:"10000",currencyCode:"SAR"}}]})).reverse();
    expect(shortlist(campaign(),creators,now).map((row)=>row.creatorId)).toEqual(Array.from({length:12},(_,i)=>`id-${String(i).padStart(2,"0")}`));
  });
  it("rejects invalid subscores/confidence rather than NaN scores", () => {
    expect(()=>calculateFit({age:NaN,niche:1,geography:1,gender:1,engagement:1,budget:1,exposure:1},1)).toThrow();
    expect(()=>calculateFit({age:1,niche:1,geography:1,gender:1,engagement:1,budget:1,exposure:1},1.1)).toThrow();
  });
  it("rounds the exact59.5 threshold upward even with .4 source confidence", () => {
    const subscores={age:1,niche:1,geography:0,gender:1,engagement:1,budget:1,exposure:1};
    expect(calculateFit(subscores,0.4)).toEqual({weightedFit:0.85,score:60});
    const candidate=creator({nicheSlugs:fact(["beauty"],"SELF_REPORTED"),accounts:[account({audience:{...account().audience,cities:fact([{key:"SA:jeddah",percent:100}])}})]});
    expect(shortlist(campaign(),[candidate],now)[0]?.score).toBe(60);
  });
});

describe("eligibility before scoring", () => {
  it("cannot use an API snapshot label when every usable metric is self-reported", () => {
    const candidate=creator({accounts:[account({followers:fact(10000,"SELF_REPORTED"),engagementPct:null,averageViews:[],audience:{age:null,gender:null,countries:null,cities:null}})]});
    expect(evaluateCreator(campaign(),candidate,now).eligible).toBe(false);
  });
  it("enforces reviewed persistent no-go evidence without treating it as a fresh metric", () => {
    const candidate=creator({safetyExclusions:[{topic:"gambling",policyVersionId:"safety-v1",reviewed:true,evidence:evidence("SELF_REPORTED",{evidenceAt:"2026-01-01T00:00:00.000Z",visibility:"PRIVATE"})}]});
    expect(evaluateCreator(campaign({noGoTopics:["gambling"]}),candidate,now).eligible).toBe(false);
    expect(evaluateCreator(campaign({noGoTopics:["alcohol"]}),candidate,now).eligible).toBe(true);
  });
  it("enforces tier and verification preferences on relevant evidence", () => {
    expect(evaluateCreator(campaign({preferredTiers:["MEGA"]}),creator(),now).eligible).toBe(false);
    expect(evaluateCreator(campaign({dataVerificationRequired:true}),creator({accounts:[account({audience:{age:fact([{key:"18-24",percent:100}],"SELF_REPORTED"),gender:null,countries:null,cities:null}})]}),now).eligible).toBe(false);
  });
  it("requires current reviewed jurisdiction/account-scoped optional licences", () => {
    const required=campaign({preferredLicencePolicyIds:["mawthooq"]});
    const good={id:"licence",policyIds:["mawthooq"],jurisdiction:"SA",status:"VERIFIED" as const,accountIds:["a1"],reviewedAt:now,expiresAt:period.endsAt};
    expect(evaluateCreator(required,creator({licences:[good]}),now).eligible).toBe(true);
    for(const overrides of [{status:"PENDING" as const},{status:"REVOKED" as const},{status:"NEEDS_RECHECK" as const},{jurisdiction:"EG"},{accountIds:[]},{expiresAt:now},{reviewedAt:null}]) expect(evaluateCreator(required,creator({licences:[{...good,...overrides}]}),now).eligible).toBe(false);
  });
  it("accepts exactly90days and excludes older/future evidence", () => {
    const boundary = new Date(Date.parse(now)-90*24*60*60*1000).toISOString();
    expect(evaluateCreator(campaign(),creator({accounts:[account({evidence:evidence("API",{evidenceAt:boundary})})]}),now).eligible).toBe(true);
    for(const evidenceAt of [new Date(Date.parse(boundary)-1).toISOString(),new Date(Date.parse(now)+1).toISOString()]) expect(evaluateCreator(campaign(),creator({accounts:[account({evidence:evidence("API",{evidenceAt})})]}),now).eligible).toBe(false);
  });
  it.each([{hidden:true},{suspended:true},{isTest:true},{eligible:false},{brandVisible:false}])("excludes protected creator flags %j", overrides => expect(evaluateCreator(campaign(),creator(overrides),now).eligible).toBe(false));
  it("excludes protected incomplete records before inspecting their private domain facts", () => {
    expect(evaluateCreator(campaign(),creator({hidden:true,residenceCountryCode:"ZZ",accounts:[account({followers:fact(NaN)})]}),now)).toMatchObject({eligible:false,relevantAccounts:[],match:null});
  });
  it("requires ownership/approval/brand visibility and usable source evidence", () => {
    for(const overrides of [{ownershipStatus:"UNPROVED" as const},{approved:false},{visibility:"PRIVATE" as const},{evidence:null}]) expect(evaluateCreator(campaign(),creator({accounts:[account(overrides)]}),now).eligible).toBe(false);
  });
  it("requires claimed period-confirmed availability, labels unclaimed prospects unknown", () => {
    expect(evaluateCreator(campaign(),creator({availability:{status:"AVAILABLE",period:{...period,endsAt:period.startsAt},confirmedAt:now}}),now).eligible).toBe(false);
    const result=evaluateCreator(campaign(),creator({claimStatus:"UNCLAIMED",availability:{status:"UNAVAILABLE",period:null,confirmedAt:null},accounts:[account({ownershipStatus:"UNPROVED"})]}),now);
    expect(result).toMatchObject({eligible:true,prospect:true,availability:"UNKNOWN",executableOffer:false});
  });
  it("uses language/dialect, presence/travel and reviewed rules independently of residence", () => {
    expect(evaluateCreator(campaign(),creator(),now).eligible).toBe(true);
    expect(evaluateCreator(campaign({contentLanguages:["en"]}),creator(),now).eligible).toBe(false);
    expect(evaluateCreator(campaign({dialects:["ar-EG"]}),creator(),now).eligible).toBe(false);
    expect(evaluateCreator(campaign({physicalPresenceRequired:true,presenceCountryCodes:["SA"]}),creator(),now).eligible).toBe(false);
    expect(evaluateCreator(campaign({physicalPresenceRequired:true,presenceCountryCodes:["SA"],travelAllowed:true}),creator({travelWilling:true,travelCountryCodes:["SA"]}),now).eligible).toBe(true);
    expect(evaluateCreator(campaign({mandatoryPolicyVersionIds:["sa-v1"]}),creator(),now).eligible).toBe(false);
    expect(evaluateCreator(campaign({mandatoryPolicyVersionIds:["sa-v1"]}),creator({policyOutcomes:[{policyId:"sa",versionId:"sa-v1",reviewed:true,status:"PASS",accountIds:["a1"],validUntil:period.endsAt}]}),now).eligible).toBe(true);
  });
  it("does not let irrelevant/private/stale accounts affect score or confidence", () => {
    const base=evaluateCreator(campaign(),creator(),now);
    const result=evaluateCreator(campaign(),creator({accounts:[account(),account({id:"private",visibility:"PRIVATE",followers:fact(1000000,"SELF_REPORTED")}),account({id:"irrelevant",platform:"X",followers:fact(1000000,"SELF_REPORTED")})]}),now);
    expect(result.match).toEqual(base.match);
  });
});

describe("canonical audiences and niche", () => {
  it("uses the central parent/child/sibling taxonomy by default", () => {
    const niche = (target: string, held: string) => evaluateCreator(campaign({nicheSlugs:[target]}),creator({nicheSlugs:fact([held])}),now).match!.subscores.niche;
    expect(niche("beauty","skincare")).toBe(0.25);
    expect(niche("skincare","beauty")).toBe(0.25);
    expect(niche("skincare","makeup")).toBe(0.25);
    expect(niche("skincare","gadgets")).toBe(0);
    const fameChild = evaluateCreator(campaign({nicheSlugs:["skincare"]}),creator({nicheSlugs:fact([]),fameIndustries:fact(["fashion"],"SELF_REPORTED")}),now).match!;
    expect(fameChild.subscores.niche).toBe(0.5);
    expect(fameChild.rawConfidence).toBe(0.4);
    expect(fameChild.score).toBe(63);
  });
  it("rejects unknown applicable niche slugs and invalid historical taxonomy snapshots", () => {
    expect(()=>evaluateCreator(campaign({nicheSlugs:["invented-niche"]}),creator(),now)).toThrow(/niche/i);
    expect(()=>evaluateCreator(campaign(),creator({nicheSlugs:fact(["invented-niche"])}),now)).toThrow(/niche/i);
    for (const nicheTaxonomy of [
      [],
      [{slug:"beauty",parentSlug:"invented-niche"}],
      [{slug:"beauty",parentSlug:"makeup"}],
      [{slug:"beauty",parentSlug:null},{slug:"beauty",parentSlug:null}],
      [{slug:"beauty",parentSlug:"makeup"},{slug:"makeup",parentSlug:"beauty"}],
      [{slug:"fashion",parentSlug:null}],
    ]) expect(()=>evaluateCreator(campaign(),creator(),now,{nicheTaxonomy})).toThrow(/taxonomy|niche/i);
  });
  it("recomputes a validated historical taxonomy without changing the shared catalog", () => {
    const historical = [{slug:"beauty",parentSlug:null},{slug:"skincare",parentSlug:null}];
    const input = campaign({nicheSlugs:["skincare"]}), candidate = creator({nicheSlugs:fact(["beauty"])});
    expect(evaluateCreator(input,candidate,now,{nicheTaxonomy:historical}).match!.subscores.niche).toBe(0);
    expect(evaluateCreator(input,candidate,now).match!.subscores.niche).toBe(0.25);
  });
  it("scores zero for a specified niche with no usable relevant creator niche/fame information", () => {
    expect(evaluateCreator(campaign(),creator({nicheSlugs:null}),now).match!.subscores.niche).toBe(0);
    expect(evaluateCreator(campaign(),creator({nicheSlugs:null}),now).match!.reasons.find((reason)=>reason.criterion==="niche")).toMatchObject({kind:"NICHE_NO_DOCUMENTED_OVERLAP",observed:{criterion:"niche",subscore:0,missingDataPolicy:"ZERO_FOR_SPECIFIED_NICHE"}});
    expect(evaluateCreator(campaign(),creator({nicheSlugs:fact([])}),now).match!.subscores.niche).toBe(0);
    expect(evaluateCreator(campaign(),creator({nicheSlugs:{value:["beauty"],evidence:evidence("API",{visibility:"PRIVATE"})}}),now).match!.subscores.niche).toBe(0);
    expect(evaluateCreator(campaign(),creator({nicheSlugs:{value:["beauty"],evidence:evidence("API",{evidenceAt:"2026-01-01T00:00:00.000Z"})}}),now).match!.subscores.niche).toBe(0);
    expect(evaluateCreator(campaign(),creator({nicheSlugs:null,fameIndustries:fact(["cooking"])}),now).match!.subscores.niche).toBe(0);
    expect(evaluateCreator(campaign({nicheSlugs:[]}),creator({nicheSlugs:null}),now).match!.subscores.niche).toBeNull();
    expect(evaluateCreator(campaign(),creator({nicheSlugs:null,fameIndustries:fact(["fashion"])}),now).match!.subscores.niche).toBe(0.5);
  });
  it("uses follower-weighted dimensions without renormalizing or invented followers", () => {
    const result=aggregateAudience([account({followers:fact(100),audience:{age:fact([{key:"18-24",percent:50}]),gender:null,countries:null,cities:null}}),account({id:"a2",followers:fact(300),audience:{age:fact([{key:"18-24",percent:100}]),gender:null,countries:null,cities:null}}),account({id:"a3",followers:null,audience:{age:fact([{key:"18-24",percent:0}]),gender:null,countries:null,cities:null}})],now);
    expect(result.age?.buckets).toEqual([{key:"18-24",percent:87.5}]);
    expect(result.age?.unreportedPercent).toBe(12.5);
    expect(result.age?.excludedAccountIds).toContain("a3");
    expect(result.gender).toBeNull();
  });
  it("validates duplicates, total, finite percentages and documentary rounding tolerance", () => {
    const invalidRows: Bucket<AudienceAgeBucket>[][] = [[{key:"18-24",percent:101}],[{key:"18-24",percent:50},{key:"18-24",percent:50}],[{key:"18-24",percent:NaN}],[{key:"18-24",percent:60},{key:"25-34",percent:40.01}]];
    for(const rows of invalidRows) expect(()=>aggregateAudience([account({audience:{age:fact(rows),gender:null,countries:null,cities:null}})],now)).toThrow();
    const rounded={...fact<Bucket<AudienceAgeBucket>[]>([{key:"18-24",percent:60},{key:"25-34",percent:40.01}]),roundingToleranceDocumented:true};
    expect(aggregateAudience([account({audience:{age:rounded,gender:null,countries:null,cities:null}})],now).age?.unreportedPercent).toBe(0);
  });
  it("uses equal target bins, discounted country fallback, never residence", () => {
    const result=evaluateCreator(campaign({targetAgeBuckets:["18-24","25-34"]}),creator({residenceCountryCode:"SA",accounts:[account({audience:{age:fact([{key:"18-24",percent:100}]),gender:null,countries:fact([{key:"SA",percent:100}]),cities:null}})]}),now).match!;
    expect(result.subscores.age).toBe(0.5);
    expect(result.subscores.geography).toBe(0.8);
    expect(result.geographyBasis).toBe("COUNTRY_FALLBACK");
    const unknown=evaluateCreator(campaign(),creator({residenceCountryCode:"SA",accounts:[account({audience:{age:null,gender:null,countries:null,cities:null}})]}),now).match!;
    expect(unknown.subscores.geography).toBeNull();
    expect(unknown.reasons.every(reason=>reason.kind!=="JOINT_DEMOGRAPHIC")).toBe(true);
  });
  it("keeps exact and related niche hits disjoint and fame outside union", () => {
    expect(nicheFit(["beauty","fashion"],["beauty"],["fashion"],[])).toBe(0.75);
    expect(nicheFit(["beauty"],["beauty"],["beauty"],[])).toBe(1);
    expect(nicheFit(["beauty"],[],[],["beauty"])).toBe(0.5);
    expect(nicheFit(["beauty"],[],[],[])).toBe(0);
    expect(nicheFit([],[],[],[])).toBeNull();
  });
});

describe("exact currency-qualified supported basket", () => {
  it("keeps a declared unknown minimum distinct from an absent minimum", () => {
    const quote=quoteBasket(creator({minimumDeal:null,minimumDealKnown:false}),campaign().deliverables,[account()],"SAR");
    expect(quote).toMatchObject({coverage:"PARTIAL",minimumKnown:false,total:null,comparisonAmount:null,subtotal:{amountMinor:"10000",currencyCode:"SAR"}});
    expect(budgetFit(quote,campaign().budget)).toBeNull();
    expect(quoteBasket(creator(),campaign().deliverables,[account()],"SAR").coverage).toBe("FULL");
  });
  it("keeps zero allocations and absent targets unknown; exact budget endpoints", () => {
    const quote=quoteBasket(creator(),[{platform:"INSTAGRAM",format:"REEL",count:1}],[account()],"SAR");
    expect(budgetFit(quote,{amountMinor:"0",currencyCode:"SAR"})).toBeNull();
    expect(budgetFit(quote,{amountMinor:"10000",currencyCode:"USD"})).toBeNull();
    const at150=quoteBasket(creator({rates:[{creatorId:"creator-a",platform:"INSTAGRAM",format:"REEL",amount:{amountMinor:"15000",currencyCode:"SAR"}}]}),[{platform:"INSTAGRAM",format:"REEL",count:1}],[account()],"SAR");
    expect(budgetFit(at150,{amountMinor:"10000",currencyCode:"SAR"})).toBe(0);
    expect(evaluateCreator(campaign({impressionsTarget:0}),creator(),now).match?.subscores.exposure).toBeNull();
  });
  it("rejects unowned/duplicate rates and merges duplicate requested rows", () => {
    const requested=[{platform:"INSTAGRAM" as const,format:"REEL" as const,count:1},{platform:"INSTAGRAM" as const,format:"REEL" as const,count:1}];
    expect(quoteBasket(creator(),requested,[account()],"SAR").total?.amountMinor).toBe("20000");
    expect(()=>quoteBasket(creator({rates:[{...creator().rates[0],creatorId:"another"}]}),requested,[account()],"SAR")).toThrow();
    expect(()=>quoteBasket(creator({rates:[creator().rates[0],creator().rates[0]]}),requested,[account()],"SAR")).toThrow();
  });
  it("uses labeled hypothesis fallback, keeps unsupported/unknown rows separate", () => {
    const result=evaluateCreator(campaign({deliverables:[{platform:"INSTAGRAM",format:"STORY",count:2},{platform:"INSTAGRAM",format:"LIVE",count:1},{platform:"X",format:"POST",count:1}]}),creator({accounts:[account({supportedFormats:["STORY","LIVE"]})]}),now).match!;
    expect(result.estimatedImpressions).toMatchObject({total:null,knownSubtotal:6000,hypothesisVersion:"infame-platform-hypotheses-v1",uniqueAudience:false});
    expect(result.estimatedImpressions.rows.map((row)=>row.basis)).toEqual(["FOLLOWER_HYPOTHESIS","UNKNOWN"]);
    expect(result.quote.unsupported).toEqual([{platform:"X",format:"POST",count:1}]);
    expect(result.subscores.exposure).toBeNull();
  });
  it("does not duplicate a placement over multiple same-platform accounts", () => {
    const result=evaluateCreator(campaign(),creator({accounts:[account(),account({id:"a2"})]}),now).match!;
    expect(result.estimatedImpressions.total).toBe(10000);
    expect(result.estimatedImpressions.rows[0].accountId).toBe("a1");
  });
  it("validates units, finite observations, evidence windows and safe estimates", () => {
    expect(()=>evaluateCreator(campaign(),creator({accounts:[account({engagementContext:null})]}),now)).toThrow();
    expect(()=>evaluateCreator(campaign(),creator({accounts:[account({averageViews:[{...account().averageViews[0],window:period}]})]}),now)).toThrow();
    expect(()=>evaluateCreator(campaign(),creator({accounts:[account({averageViews:[{...account().averageViews[0],value:fact(Infinity)}]})]}),now)).toThrow();
    expect(()=>evaluateCreator(campaign({deliverables:[{platform:"INSTAGRAM",format:"REEL",count:1000}]}),creator({accounts:[account({averageViews:[{...account().averageViews[0],value:fact(Number.MAX_SAFE_INTEGER)}]})]}),now)).toThrow();
  });
  it("enables exposure hypotheses only with explicit reviewed matching market/currency/goal", () => {
    const benchmark={id:"sar-awareness",version:"v1",reviewed:true,enabled:true,reviewedAt:now,marketCountryCodes:["SA"],currencyCode:"SAR",goal:"AWARENESS",impressionsPerMajorUnit:{numerator:"4",denominator:"1"}};
    expect(evaluateCreator(campaign({impressionsTarget:null}),creator(),now,{exposureBenchmark:benchmark,campaignGoal:"AWARENESS"}).match?.allocatedImpressionsTarget).toBe(400);
    expect(evaluateCreator(campaign({impressionsTarget:null}),creator(),now,{exposureBenchmark:{...benchmark,enabled:false},campaignGoal:"AWARENESS"}).match?.subscores.exposure).toBeNull();
    expect(evaluateCreator(campaign({impressionsTarget:null,marketCountryCodes:["EG"]}),creator(),now,{exposureBenchmark:benchmark,campaignGoal:"AWARENESS"}).match?.subscores.exposure).toBeNull();
    expect(evaluateCreator(campaign({impressionsTarget:null}),creator(),now,{exposureBenchmark:{...benchmark,currencyCode:"USD"},campaignGoal:"AWARENESS"}).match?.subscores.exposure).toBeNull();
  });
  it("never extrapolates partial/mismatched/minimum quotes", () => {
    const requirements=[{platform:"INSTAGRAM" as const,format:"REEL" as const,count:2},{platform:"INSTAGRAM" as const,format:"STORY" as const,count:1},{platform:"X" as const,format:"POST" as const,count:1}];
    const result=quoteBasket(creator(),requirements,[account()],"SAR");
    expect(result).toMatchObject({coverage:"PARTIAL",subtotal:{amountMinor:"20000",currencyCode:"SAR"},total:null,unsupported:[{platform:"X",format:"POST",count:1}]});
    expect(budgetFit(result,{amountMinor:"10000",currencyCode:"SAR"})).toBeNull();
    const mismatch=quoteBasket(creator({minimumDeal:{amountMinor:"10000",currencyCode:"USD"}}),[{platform:"INSTAGRAM",format:"REEL",count:1}],[account()],"SAR");
    expect(mismatch.coverage).toBe("PARTIAL");
    expect(mismatch.total).toBeNull();
  });
  it("calculates decay with BigInt beyond safe integers, rejects overflow", () => {
    const allocation={amountMinor:"9007199254740992",currencyCode:"JPY"};
    const quote=quoteBasket(creator({rates:[{creatorId:"creator-a",platform:"INSTAGRAM",format:"REEL",amount:{amountMinor:"11258999068426240",currencyCode:"JPY"}}]}),[{platform:"INSTAGRAM",format:"REEL",count:1}],[account()],"JPY");
    expect(budgetFit(quote,allocation)).toBe(0.5);
    expect(()=>quoteBasket(creator({rates:[{creatorId:"creator-a",platform:"INSTAGRAM",format:"REEL",amount:{amountMinor:"9223372036854775807",currencyCode:"SAR"}}]}),[{platform:"INSTAGRAM",format:"REEL",count:2}],[account()],"SAR")).toThrow();
  });
  it("allocates immutable ordinals independently of ranking and does not infer exposure targets", () => {
    const result=evaluateCreator(campaign({budget:{amountMinor:"10001",currencyCode:"SAR"},desiredCreatorCount:3,allocationOrdinal:1,impressionsTarget:null}),creator(),now).match!;
    expect(result.allocation.amountMinor).toBe("3334");
    expect(result.subscores.exposure).toBeNull();
    expect(result.estimatedImpressions.total).toBe(10000);
  });
  it("does not manufacture campaign-package impressions", () => {
    const result=evaluateCreator(campaign({deliverables:[{platform:"INSTAGRAM",format:"CAMPAIGN",count:1}]}),creator({accounts:[account({supportedFormats:["CAMPAIGN"]})]}),now).match!;
    expect(result.estimatedImpressions.total).toBeNull();
    expect(result.subscores.exposure).toBeNull();
  });
  it("uses weakest actually applicable source; approval never upgrades source", () => {
    const result=evaluateCreator(campaign(),creator({accounts:[account({audience:{age:fact([{key:"18-24",percent:100}],"SELF_REPORTED"),gender:fact([{key:"FEMALE",percent:100}]),countries:null,cities:fact([{key:"SA:riyadh",percent:100}])}})]}),now).match!;
    expect(result.rawConfidence).toBe(0.4);
    expect(result.score).toBe(70);
  });
});
