# Schema23A: retained admission aggregate only

2026-10-08. Concrete first native slice after8ea8efd pure contracts and79871b3
history. Root owns schema/additive migration23 and all guarded execution; an
independent author owns native SQL failures and reviewer is read-only. No app
routes/importer/source classification/manifest authority/fresh contract gate.
Later four manifest/receipt/link records remain separately composed prerequisites.

First3scalar records only:
LegacyDirectAdmission(id,provenance,capability,campaignId,brandId,brandUserId,
creatorId,creatorUserId,createdAt). IDs centralASCII1..200 includingliteralstar;
provenanceLIVE|DEVELOPMENT_FIXTURE; capabilityFRESH_PINNED_SCOPE|CONTINUE_PINNED_DEAL;
actualusersdiffer. Allidentity/subject/capability/provenance/creation immutable.
FKcampaignId/brandId referencesCampaign(id,brandId) RESTRICT, andexplicit restrictive
Brand/Creator/User IDs. NeverbindoriginaluserstoCurrentBrand/Creator.userId tuple.
Uniquefullparentidentity/provenance/capability/subject tuple forversions.

LegacyDirectAdmissionVersion(id,admissionId,provenance,capability,version,content,
sourceHash,createdAt). Exactparent subject/provenance/capability scalar columns or
validatedcontentprojection mustmatch parent underlock. Strict bounded131072compact
JSONbinding schemaVersion1/admissionId/provenance/version/capability/subject/
approvedBrief/validity/manifest/source/(CONTINUEexistingDealonly). Sourcehashshape
SQL; fullcentral runtime parsing/canonicalhash/producer/source/manifest resolution
remainfutureimport responsibility. Add exact pinned brief columns id/version/
inputRevision/approvedByUserId/contentHash and FK(id,campaignId) toactualBrief;
originalapprover equalsparentBrandUser. Native recordbinding/approval/context must
be checkedstructurally underlocks without hydrating live Campaign.input.
FRESHexistingDeal fields allNULL; CONTINUEexistingDealId/firstOfferId/version1/
originalparty/hash columns full and restrictive nativeFKs/identitychecks. Separate
nativeCampaignCommandId/dealCommandId exclusive sourcebranch, actor/key/payload/
result hash pins match content and actual native source actor/key/hash, restrictive
references retain original journals. Current source producersemantics/hash ofnative
result/controlledreview areNOT proven by an ID/FK/storage label.

Versionsappendconsecutive1..2147483646 understableparentFORUPDATE; parentstate
mustexist/nonrevoked. No UPDATE. Fullidentity/provenance/capability/parent/version/
hash tuples forfutureState/manifest/link FKs. No canonicalhash guessinginSQL.
FullfuturemanifestId/entryId staysdeclared but unresolved/inert inthisfirstslice;
activationREQUIRESnextschema/exactmanifest/importreceipt/nativeproof. ACTIVE here
is a storage lifecycle label only, no legal/application permission or provider.

LegacyDirectAdmissionState(admissionId,revision,state,currentVersionId/currentVersionNumber/currentSourceHash
allnullorfull,createdAt,updatedAt). Same reviewedmigration21initialDRAFT1null,
consecutive revisions/monotonicdate/pointer/nonreturnDRAFT/latestACTIVE/full PAUSED
pointer/revokedterminal guards. No recreation overretainedversions. Deferred
AFTERDELETE guardrejectscommitwhenparentstillEXISTS; therefore state/versions cannot
be purged and reset under survivingstableidentity. Complete ownedaggregate teardown
atomic deletesstate→versions→parent; externalnativeFKs retain referencedhistory.
Future permanentconsumptionLink/importreceipt guards remainseparate beforeanyuse.

UTCtimestamp3 supportedyears1..9999, createdAt/projectiondates chronological; exact
hashlowercase64hex. Contentmatching safejsonb shapes/arrays/caps beforeextraction,
centralruntimeoriginals/countries/keyforms/validity stillvalidatedoutsideSQL. No
current-clock/liveness/sourcequalification claimfromSQLCURRENT_TIMESTAMP.

Lock freeze for existing-deal/source validation: sorted requiredcurrent+original
Users first, exactsessionwhenappinterface exists, appropriate domainBrand/Creator/
Campaign before existingDeal→firstOffer→approvedBrief; admissionparent/state/version
inoneconsistent globalorder reconciledwithhistory. Rawstoragetests nevergrant
nativeappauthority. Rootmustfinalize trigger/source ordering with reviewer before
running migration; no nonexistentactioncolumn/datecutoff/inheritedsourcecopy.

Independentnativefour groups beforeDDL: (1) fullvalidFRESH/CONTINUEbindings and
native exactsubject/brief/source tuple substitution/provenance/nullbranch failures;
(2) immutable UPDATE/consecutiveversions/statepointers/latest/revoked failures;
(3) realparentlock/versionrace/rollbacknoorphans/currentdates/oversizeJSON failures;
(4) restrictive nativehistory retention +stateDELETE survivingparent/recreate
fails, complete all-ownedaggregate atomicteardown succeeds without triggerbypass.
Exact fixture taskmarker/kind/loopback verified; sourcelegalproof synthetic/disclosed,
no actualproducer/import/admission activation. Fullfourgates/sourceindexreview
beforestorage commit; future nativeproof/manifest/fence/UI phases remain required.


Exact version scalar column refinement before witness authoring:
id,admissionId,provenance,capability,version,content,sourceHash,createdAt;
approvedBriefId,approvedBriefVersion,approvedInputRevision,approvedByUserId,
approvedContentHash; manifestId,manifestEntryId; sourceActorUserId,
sourceOperationKey,sourcePayloadHash,sourceResultHash,campaignCommandId|null,
dealCommandId|null; existingDealId|null,existingDealHash|null,firstOfferId|null,
firstOfferVersion|null,firstProposerUserId|null,firstRecipientUserId|null,
firstOfferContentHash|null. Parent subject is captured as thin metadata, then re-read under parent lock and
validated against the unchanged capture/content; existing parentcompound FK coversactual campaignBrand.
Version->parent full(id,provenance,capability) composite. Source exact IDs RESTRICT;
insert guard matches native CampaignCommand.campaignId/actor/key/payload or
DealCommand.dealId/actor/key/payload and CONTINUE Deal campaignBrandCreator/brief/
firstOffer IDs+version1+originalusers. ApprovedBrief native id/campaign/version/
inputRevision/originalapprovedBy matches approvednonnull row. SQL doesNOTcompute
canonical result/content/stableDeal/firstOffer hashes; runtime exactproducerproof
and currentlockedsource revalidation stillmandatory beforefutureactivation.

No native source UPDATE prohibition added globally inthisslice. RetainedIDFKs stop
delete; corrupt changed source fields causefuturecurrentrevalidationdenial, not
assumedimmutableproof. Do not bind admissionversions to mutable lifecycle/status/
currentprofileowner fields. Manifestentry/finalreceipt binding is UNRESOLVED and
state cannotbeuseduntilnextstorage/importproof phase. Thisexplicitinertsplitmust
be reflected in acceptance and cannotserveas globaldevelopment admission bypass.


FINAL source/parent lock decision from independent review:
Version insertion captures thin stable-parent metadata (noauthority), then sorted
requiredUsers/domain locks, existingDeal→firstOffer→approvedBrief→exactsource
journal, THENadmissionparentFORUPDATE. Re-readfullparent snapshot afterwait; ifit
changed reject/retry withoutlateUser/native locks, thenvalidatecontent/nextversion.
State-only operations lockparent andMUSTNOTlocknativesources afterward. Theseorders
need real separateconnection witnesses beforeclaimedacceptance.

Cleanup MUSTNOTholdparent andthenwaitfordeletingnativeDeal/brief/source/User rows
that aVersion writer alreadyholds beforewaitingparent. First atomicall-owned
aggregatecleanup locksUsers(asneeded) thenparent, deletesState→Versions→Parent,
COMMIT; onlyafterward originalnativefixture rowsdelete. Alternatively acquirethe
exactnative-source-firstorder forwholesalegraphcleanup. No mixedparent-first /
native-delete transaction. DeferredStateDELETE checksparentabsenceatcommit; state
recreateunder survivingidentity fails, allnative/sourceFK retention staysRESTRICT.
Manifest/receipt/link nextphase mustinheritthissameorder, notreverseBrief/Deal.
