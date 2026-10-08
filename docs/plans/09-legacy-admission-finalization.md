# Schema24A finalization storage freeze preparation

2026-10-08, prerequisitef49710c reviewednative23. RootownsSchema24/sharedcontracts/
controlledtrust, independentSQLauthor/reviewer beforeDDL. FourrecordsONLY, no runtime
importer/newcontract permission. Preserve23Version/history includingunlinked rows.

LegacyAdmissionManifest: id,provenance,content,digest,createdAt. PKid; UNIQUE(id,provenance) and full(id,prov,
digest)unique; content131072bytes exact existingManifestContentSchema projection
manifestId=id/prov/date/hashshape. Canonicaldigest recomputedruntime (notSQLlabel).
ImmutableUPDATE, entriesdeclared1..50 uniqueentryId andadmission/version/order.

LegacyAdmissionManifestEntry: manifestId,entryId,ordinal,versionId,admissionId,
provenance,capability,version,sourceHash,createdAt. PK(manifestId,entryId), unique
(manifestId,ordinal), unique(manifestId,admissionId,version), UNIQUEversionId,
full tuple unique forreceipt/link/memberFKs. FKmanifest(id,prov), fullVersion
(id,admissionId,prov,capability,version,sourceHash) RESTRICT. ENTRYISFINALIZATIONLINK;
noVersion→Entry FK/extrajoin/backfill/mutation/NOTVALID. GuardmatchesVersionoriginal
manifestId/entryId, exactcontentorderedordinal scalar{entryId,admissionId,version,
sourceHash}. Old/newVersion withoutEntry staysunfinalized. InsertVersion first,
ManifestthenEntries thenfinalReceipt; multi-entrylockparentIDs sortedbeforemanifest.

LegacyAdmissionImportReceipt: id,importKey(UUID),manifestId,provenance,digest,
bundleHash,verifierVersion,entryCount,createdAt. PKid, uniqueimportKey,
UNIQUEmanifestId (oneimmutablefinalization), full(id,manifestId,prov,digest)unique,
FKmanifestfulltupleRESTRICT. GuardlocksfullaffectedsortedparentIDs thenmanifest,
checksDECLAREDmanifestentrycount/exactordinals1..N/actualEntry↔Versionbijective
exactoriginaldeclaredpins/prov/hash/capability/manifestidentity. Incomplete/extra/
foreign/transposedcopies fail. Sourceproducerverification/digestallowlistruntime
SEPARATErequired; SQLfinalized label doesnotadmitanything. ReciptJSONnotneeded.

FreshDealAdmissionLink: admissionId(PKlifetime),dealId(UNIQUE),versionId,version,
sourceHash,provenance,capability('FRESH_PINNED_SCOPE'),manifestId,manifestEntryId,
digest,importReceiptId,firstOfferId,firstOfferVersion(1),brandUserId,creatorUserId,
approvedBriefId,approvedBriefVersion,createCommandId,createOperationKey,
createPayloadHash,createResultHash,createdAt. FullVersionandEntry/member FK+
fullfinalReceipt(id,manifestId,prov,digest)RESTRICT; nativeDeal/firstOffer/Brief/
DealCommand IDsRESTRICT, guardactualsubject/brief/sourcefirstusers/currencyterms
consistentwithversiondeclaredsource (canonicalhashedterms/runtimeproducerproof
outsideSQL). StableAdmissionPKoneuse, versions/cancelneverreplenish.

AllscalarIDsASCII1..200/hasheslowerhex64; ordinal/count1..50, version1..2147483646,
UTCtimestamp3year1..9999, originalreviewtextpreservedboundedmanifestJSON. Immutable
all4recordsUPDATE. No data normalization orcurrentprofileowner substitution.

Native-sourcefirstlockorder: completeUserIDs/sessionwhenappinterface exists,
Brand/Creator/Campaign→existingDeal→firstOffer→approvedBrief→sourcejournals, THEN
sortedadmissionparents, THENsortedmanifests/entries/receipts/link. Manifest/Entry/
Receipt storageonlycommands no furthernative locksAFTERparent; immutableVersion
pins alreadyheld/sourceproofruntime. Delete/cleanupconsistentparent→manifest and
COMMITaggregatebeforeoriginalnativefixturedeletion. NeedindependentSQLconcurrency
proof foralloverlap, notorderclaimedfromprose.

Receipt-awaredelete retention andFreshLink deferredsurvivingparent rejection exact
SQLfreezeNEXT. No lifecycleactivationuntiltheseinvariants/nativeproducer/trusted
allowlist/currentactorsourcechecks exist. No ordinaryADMIN/app writer/globalfixture
bypass. Localactualall23tables0rows aftertestshelpsmigrationtest, generalunfinalized
records preserved. RuntimeLIVEallowlistemptydefault/prodrejectfixtures; fullgoal
managed/AIvoice/media/MVP beyond thisstorage stillrequired.


FINALlockrefinement: pre-readonlyVersion/Entry/native IDs asmetadata (nolocks),
acquirecomplete nativeUser/sourceinventory FIRST, thenALLsortedadmissionparents,
THENretainedVersions→sortedManifests→Entries→Receipts/Link. NeverVersion/EntrySHARE
beforeparent, ormanifest beforeacquiringnewparents. Parent-thenVersionDELETE from
23cleanupmustnotreversewaitwithfinalization. Finalreceiptinsertion revalidatesactual
native source/brief/Deal/firstOffer scalarpins underthatinventory beforecompleteness;
canonicalproducer/result/material/trustdigest proofstillruntimeoutsideSQLclaims.

FINALretention: whilefinalReceipt exists noEntrydelete. ReverseEntryFKprotects
Version/parent. FreshLinkfullfinalReceiptFKprotectsconsumedreceipt; deferredLink
andexistingStatedeletefailatCOMMITifstableparentsurvives, evendelete/reinsert.
ImmutableUpdateall4. Exactwhole-ownedgraphatomicteardownaftertask/sharedgraphchecks
andUser/native→sortedparent→sortedmanifest locks: States→Links→Receipts→Entries→
Versions→Manifests→Parents, COMMITbeforeoriginalnativefixture deletion. No trigger
bypass/envwidefixturepermission/userAPI. Newreceiptmaynotfinalizebylabels/rawdates
orunownedproducer; canonicalsource verifier/trustallowlist prerequisite remains.


FINALreviewclarifications beforetestauthor:
EntryINSERT/DELETE andReceiptINSERT/DELETE serializethesame capturedALLsorted
admissionparentinventory thenManifestFORUPDATE. FullEntryversion/parentinventory
ispre-readmetadata andrereadafterlocks; discoverychangesreject/retrywithNOlateparent
locksaftermanifest. Thusreceiptfinalization cannotraceEntrydelete intoa broken
bijection. Allmutations whileReceipt exists mustretaincompleteorderedmembership.

FreshLink selectsEXACTEntrymembertuple includingmanifestId/entryId/versionId/
admissionId/provenance/capability/version/sourceHash andmatchesfinalReceipt's
manifest/digest/provenance. ActualnewDealCommand separatelymatchdealId=Link.dealId,
actorUserId=brandUserId, operationKey/payloadHash andvalidatedneutralresultpin.
FRESHimport'sCampaignCommand isdistinctoldsource; nevercompareitsSourceHash to
newDealCREATE asif samecommand. NewDealfirstOffer+subject/approvedbrief pinschecked
underheldnativeinventory. SQL doesNOTproveCREATE semantics solelyfromresult/version
orlabels; futureoriginalproducer verifier/canonicalresult/trustdigest mandatory.


ExactreferencedUNIQUEtuples: Manifest(id,provenance) forEntryFK and
(id,provenance,digest) forReceipt. Entry fullmember UNIQUE(manifestId,entryId,
versionId,admissionId,provenance,capability,version,sourceHash) named
LegacyAdmissionManifestEntry_exact_member; FreshLink uses exactlythatorderedtuple.
RootPrisma interfacesinclude bothManifestuniqueconstraints andexactEntry
member uniqueness. TheseconstraintspreserveacyclicFKequality,
notCanonical/trustedsource/permission claims.

## Reviewed implementation boundary (2026-10-08)

Migrations24–29 implement the four storage records. Runtime imports and commercial
admission are still inactive. READ COMMITTED and SERIALIZABLE are supported;
REPEATABLE READ mutations are rejected because its old snapshot cannot prove
post-wait membership. INSERT captures native source inventory before sorted
parents, Versions and Manifest, then rechecks completeness without Entry row locks.

DELETE already owns its target tuple before a row trigger runs. It therefore uses
NOWAIT for the complete preceding source/parent/version/manifest inventory and
rejects contention with23514. It must be retried from the beginning with ordered
prelocks; it must never wait backwards through a Link's automatic FK locks.
INSERT-only validation triggers leave UPDATE to immediate immutable rejection.
Finalized members cannot be deleted, and deferred Link deletion fails at COMMIT
if its stable admission survives, including delete/reinsert attempts.

SQL validates typed ordered manifest projection, civil UTC timestamps, exact scalar
and native subject/party/brief/CREATE-result bindings. Reference text/language
validation in SQL is structural; the runtime schema remains authoritative for
ECMAScript trim, UTF16 length and Intl BCP47 semantics. Canonical manifest/source
digests, original producer material, trusted allowlists and current application
authority still require the next controlled importer. Storage labels confer none.
