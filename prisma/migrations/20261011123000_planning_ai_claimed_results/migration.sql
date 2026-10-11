-- REVIEW DRAFT: additive Attempt/Result native storage, migrations32/33 prerequisite.
-- Root alone adopts and executes this file. No SDK/auth/provider/provisioning grants.
-- outputHash is the caller's SHA256(exact COMPLETE UTF8 provider text). The raw
-- text is deliberately not stored; SQL checks its grammar, not unobservable bytes.
-- wireHash is independently recomputed from normalized retained output below.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
-- Fence every preexisting aggregate writer until all replacements are committed.
LOCK TABLE "PlanningWorkspace", "CampaignPlanningBinding", "CampaignAgent",
  "PlanningAiPool", "PlanningAiEnrollment", "PlanningAiSeat", "PlanningAiCycle",
  "PlanningAiSession", "PlanningAiOperation", "AiReservation", "AdminAudit"
  IN SHARE ROW EXCLUSIVE MODE;
DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT id FROM "PlanningAiCycle" LOOP
    PERFORM infame_planning_ai_assert_cycle_counts(c);
  END LOOP;
  IF EXISTS (SELECT 1 FROM "PlanningAiSession" WHERE "allowanceState" NOT IN ('HELD','RELEASED') OR "firstAttachedResultId" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "PlanningAiOperation" WHERE state <> 'OPEN' OR "successfulResultId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Incompatible planning history; migration refuses repair/reset' USING ERRCODE='23514';
  END IF;
END $$;

-- Fixed ASCII keys retain the existing codec and all historical ledger hashes.
CREATE FUNCTION infame_planning_ai_hash(v jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT encode(sha256(convert_to(infame_reference_canonical(v),'UTF8')),'hex') $$;
CREATE FUNCTION infame_planning_ai_closed(v jsonb, keys text[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT (jsonb_typeof(v)='object' AND v ?& keys AND v - keys = '{}'::jsonb) IS TRUE $$;
CREATE FUNCTION infame_planning_ai_jid(v jsonb, nullable boolean DEFAULT false) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT (CASE WHEN nullable AND v='null'::jsonb THEN true ELSE jsonb_typeof(v)='string' AND infame_planning_ai_id(v#>>'{}') END) IS TRUE $$;
CREATE FUNCTION infame_planning_ai_jhash(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT (jsonb_typeof(v)='string' AND (v#>>'{}') COLLATE "C" ~ '^[a-f0-9]{64}$') IS TRUE $$;
CREATE FUNCTION infame_planning_ai_jint(v jsonb, lo numeric, hi numeric) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN (jsonb_typeof(v)='number' AND (v#>>'{}') ~ '^(0|[1-9][0-9]*)$' AND (v#>>'{}')::numeric BETWEEN lo AND hi) IS TRUE;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false; END $$;
CREATE FUNCTION infame_planning_ai_minor(v jsonb, positive boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN (jsonb_typeof(v)='string' AND (v#>>'{}') ~ '^(0|[1-9][0-9]{0,18})$'
 AND (v#>>'{}')::numeric <= 9223372036854775807 AND (NOT positive OR (v#>>'{}')::numeric>0)) IS TRUE;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false; END $$;
CREATE FUNCTION infame_planning_ai_ledger_id(v text) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT v COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' AND position('://' in v)=0 $$;
CREATE FUNCTION infame_planning_ai_utc(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE t timestamp(3); s text;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 s:=v#>>'{}';
 IF s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$' THEN RETURN false; END IF;
 t:=s::timestamp(3);
 RETURN isfinite(t) AND to_char(t,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=regexp_replace(s,'(?<!\.[0-9]{3})Z$','.000Z');
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false; END $$;

-- Zod .max() counts UTF16 code units; PostgreSQL length() counts code points.
CREATE FUNCTION infame_planning_ai_utf16_length(v text) RETURNS bigint LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT COALESCE(sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END),0)::bigint FROM regexp_split_to_table(v,'') ch WHERE ch<>'' $$;
CREATE FUNCTION infame_planning_ai_trim(v text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT btrim(v,chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)
 ||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)) $$;
CREATE FUNCTION infame_planning_ai_string(v jsonb, maximum int, minimum int DEFAULT 1) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT (jsonb_typeof(v)='string' AND infame_planning_ai_utf16_length(v#>>'{}') BETWEEN minimum AND maximum
 AND (v#>>'{}') !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]') IS TRUE $$;
CREATE FUNCTION infame_planning_ai_string_array(v jsonb, maximum int, options text[] DEFAULT NULL, unique_items boolean DEFAULT true,
 text_maximum int DEFAULT 200, minimum int DEFAULT 0) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE x jsonb; seen text[]:=ARRAY[]::text[];
BEGIN
 IF NOT infame_planning_ai_array(v,minimum,maximum) THEN RETURN false; END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(v) LOOP
  IF NOT infame_planning_ai_string(x,text_maximum) OR (options IS NOT NULL AND NOT (x#>>'{}')=ANY(options))
   OR (unique_items AND (x#>>'{}')=ANY(seen)) THEN RETURN false; END IF;
  seen:=array_append(seen,x#>>'{}');
 END LOOP; RETURN true;
END $$;
-- These literal catalogs are copied from the current central contract files,
-- not queried from mutable rows and not interpreted as provider/legal readiness.
CREATE FUNCTION infame_planning_ai_countries() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW',' ') $$;
CREATE FUNCTION infame_planning_ai_currencies() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array('BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX VND VUV XAF XOF XPF AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CNY COP CRC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GTQ GYD HKD HNL HTG HUF IDR ILS INR IRR JMD KES KGS KHR KPW KYD KZT LAK LBP LKR LRD LSL MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK PHP PKR PLN QAR RON RSD RUB SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TOP TRY TTD TWD TZS UAH USD UYU UZS VED VES WST XCD XCG YER ZAR ZMW ZWG BHD IQD JOD KWD LYD OMR TND',' ') $$;
CREATE FUNCTION infame_planning_ai_niches() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array('beauty skincare makeup haircare fragrance fashion womens-fashion mens-fashion abaya streetwear accessories food restaurant-reviews home-cooking coffee desserts healthy-food fitness gym home-workout running womens-fitness health dental dermatology nutrition mental-health travel domestic-travel hotels adventure umrah-hajj tech gadgets mobile ai-tools software gaming mobile-gaming console esports streaming autos car-reviews offroad car-care ev family motherhood kids-products baby-care family-activities education languages exam-prep study-abroad skills business startups ecommerce freelancing marketing finance personal-finance stocks crypto real-estate-invest home interior-design furniture organizing diy pets cats dogs birds sports football motorsport padel martial-arts entertainment challenges pranks reactions vlogs music singing podcasts oud art illustration calligraphy graphic-design photography portrait product-photo drone real-estate residential commercial off-plan religion quran daily-adhkar islamic-lessons books book-reviews writing poetry comedy sketches standup memes luxury watches luxury-cars designer weddings bridal event-planning gifts crafts handmade candles sewing agriculture home-garden dates livestock seasons ramadan national-day riyadh-season eid news local-news opinion street-interviews',' ') $$;
CREATE FUNCTION infame_planning_ai_cities() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array('SA:riyadh SA:jeddah SA:mecca SA:medina SA:dammam SA:khobar SA:dhahran SA:al-ahsa SA:qatif SA:jubail SA:taif SA:yanbu SA:tabuk SA:buraydah SA:unaizah SA:hail SA:abha SA:khamis-mushait SA:najran SA:jazan SA:al-baha SA:hafar-al-batin SA:arar SA:sakaka',' ') $$;
CREATE FUNCTION infame_planning_ai_field_value(field_name text, v jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE x jsonb; seen text[]:=ARRAY[]::text[]; key text; platform text; format text;
BEGIN
 CASE field_name
  WHEN 'originalLanguage' THEN RETURN infame_planning_ai_language(v);
  WHEN 'title' THEN RETURN infame_planning_ai_string(v,200);
  WHEN 'productService','summary' THEN RETURN infame_planning_ai_string(v,5000);
  WHEN 'goal' THEN RETURN (jsonb_typeof(v)='string' AND (v#>>'{}') IN ('AWARENESS','SALES','APP_INSTALLS','EVENT','LAUNCH')) IS TRUE;
  WHEN 'marketCountryCodes' THEN RETURN infame_planning_ai_string_array(v,50,infame_planning_ai_countries(),true,200,1);
  WHEN 'targetCountryCodes','presenceCountryCodes' THEN RETURN infame_planning_ai_string_array(v,50,infame_planning_ai_countries());
  WHEN 'targetCityKeys' THEN RETURN infame_planning_ai_string_array(v,50,infame_planning_ai_cities());
  WHEN 'targetAgeBuckets' THEN RETURN infame_planning_ai_string_array(v,7,ARRAY['13-17','18-24','25-34','35-44','45-54','55-64','65+']);
  WHEN 'targetGenders' THEN RETURN infame_planning_ai_string_array(v,4,ARRAY['FEMALE','MALE','OTHER','UNKNOWN']);
  WHEN 'contentLanguages' THEN
   IF NOT infame_planning_ai_array(v,1,20) THEN RETURN false; END IF;
   FOR x IN SELECT * FROM jsonb_array_elements(v) LOOP
    IF x='null'::jsonb OR NOT infame_planning_ai_language(x) OR (x#>>'{}')=ANY(seen) THEN RETURN false; END IF; seen:=array_append(seen,x#>>'{}');
   END LOOP; RETURN true;
  WHEN 'dialects' THEN RETURN infame_planning_ai_string_array(v,12,ARRAY['ar-SA-central','ar-SA-western','ar-SA-eastern','ar-SA-southern','ar-SA-northern','ar-Gulf','ar-EG','ar-Levant','ar-IQ','ar-Maghreb','ar-SD','ar-Formal']);
  WHEN 'nicheSlugs' THEN RETURN infame_planning_ai_string_array(v,20,infame_planning_ai_niches());
  WHEN 'deliverables' THEN
   IF NOT infame_planning_ai_array(v,1,100) THEN RETURN false; END IF;
   FOR x IN SELECT * FROM jsonb_array_elements(v) LOOP
    platform:=x->>'platform'; format:=x->>'format'; key:=platform||':'||format;
    IF NOT infame_planning_ai_closed(x,ARRAY['platform','format','count']) OR NOT infame_planning_ai_jint(x->'count',1,1000)
     OR jsonb_typeof(x->'platform') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'format') IS DISTINCT FROM 'string'
     OR key=ANY(seen) OR (CASE platform
      WHEN 'INSTAGRAM' THEN format=ANY(ARRAY['STORY','POST','REEL','LIVE','CAMPAIGN'])
      WHEN 'TIKTOK' THEN format=ANY(ARRAY['VIDEO','LIVE','CAMPAIGN']) WHEN 'YOUTUBE' THEN format=ANY(ARRAY['VIDEO','SHORT','LIVE','CAMPAIGN'])
      WHEN 'SNAPCHAT' THEN format=ANY(ARRAY['STORY','VIDEO','CAMPAIGN']) WHEN 'X' THEN format=ANY(ARRAY['POST','CAMPAIGN']) ELSE false END) IS NOT TRUE THEN RETURN false; END IF;
    seen:=array_append(seen,key);
   END LOOP; RETURN true; -- final parsed data already merged by the central codec
  WHEN 'budget' THEN RETURN (infame_planning_ai_closed(v,ARRAY['amountMinor','currencyCode']) AND infame_planning_ai_minor(v->'amountMinor')
   AND jsonb_typeof(v->'currencyCode')='string' AND (v->>'currencyCode')=ANY(infame_planning_ai_currencies())) IS TRUE;
  WHEN 'desiredCreatorCount' THEN RETURN infame_planning_ai_jint(v,1,12);
  WHEN 'impressionsTarget' THEN RETURN (v='null'::jsonb OR infame_planning_ai_jint(v,0,9007199254740991)) IS TRUE;
  WHEN 'period' THEN
   IF NOT infame_planning_ai_closed(v,ARRAY['startsAt','endsAt','timeZone']) OR NOT infame_planning_ai_utc(v->'startsAt') OR NOT infame_planning_ai_utc(v->'endsAt')
    OR NOT infame_planning_ai_string(v->'timeZone',100) THEN RETURN false; END IF;
   RETURN (v->>'startsAt')::timestamp(3)<(v->>'endsAt')::timestamp(3)
    AND ((v->>'timeZone')='UTC' OR (v->>'timeZone') ~ '^[A-Za-z_]+(/[A-Za-z0-9_+\-]+)+$')
    AND EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=v->>'timeZone');
  WHEN 'physicalPresenceRequired','travelAllowed','dataVerificationRequired' THEN RETURN (jsonb_typeof(v)='boolean') IS TRUE;
  WHEN 'tone' THEN RETURN infame_planning_ai_string(v,500);
  WHEN 'noGoTopics' THEN RETURN infame_planning_ai_string_array(v,50,NULL,true,200);
  WHEN 'preferredTiers' THEN RETURN infame_planning_ai_string_array(v,4,ARRAY['NANO','MICRO','MACRO','MEGA']);
  WHEN 'preferredLicencePolicyIds' THEN
   IF NOT infame_planning_ai_string_array(v,50) THEN RETURN false; END IF;
   RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v) p WHERE (p#>>'{}') !~ '^[A-Za-z0-9_.:-]+$');
  WHEN 'usageRights' THEN RETURN infame_planning_ai_string(v,10000);
  WHEN 'kpis' THEN
   IF NOT infame_planning_ai_array(v,0,30) THEN RETURN false; END IF;
   FOR x IN SELECT * FROM jsonb_array_elements(v) LOOP
    IF NOT infame_planning_ai_closed(x,ARRAY['name','target']) OR jsonb_typeof(x->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'target') IS DISTINCT FROM 'string'
     OR infame_planning_ai_utf16_length(x->>'name') NOT BETWEEN 1 AND 200 OR infame_planning_ai_utf16_length(x->>'target') NOT BETWEEN 1 AND 1000
     OR infame_planning_ai_trim(x->>'name')<>(x->>'name') OR infame_planning_ai_trim(x->>'target')<>(x->>'target') THEN RETURN false; END IF;
   END LOOP; RETURN true;
  WHEN 'assumptions','openQuestions' THEN RETURN infame_planning_ai_string_array(v,30,NULL,false,500);
  ELSE RETURN false;
 END CASE;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false; END $$;
CREATE FUNCTION infame_planning_ai_fields(v jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE k text; x jsonb;
BEGIN
 IF NOT infame_planning_ai_closed(v,infame_planning_ai_field_keys()) OR infame_planning_json_bytes(v)>65536 THEN RETURN false; END IF;
 FOREACH k IN ARRAY infame_planning_ai_field_keys() LOOP IF NOT infame_planning_ai_field_value(k,v->k) THEN RETURN false; END IF; END LOOP;
 IF (v->>'physicalPresenceRequired')::boolean AND jsonb_array_length(v->'presenceCountryCodes')=0 THEN RETURN false; END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(v->'targetCityKeys') LOOP
  IF NOT (v->'targetCountryCodes') @> jsonb_build_array(left(x#>>'{}',2)) THEN RETURN false; END IF;
 END LOOP; RETURN true;
END $$;
CREATE FUNCTION infame_planning_ai_questions(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE x jsonb; BEGIN IF NOT infame_planning_ai_array(v,0,30) THEN RETURN false; END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(v) LOOP IF NOT infame_planning_ai_text(x,500) THEN RETURN false; END IF; END LOOP; RETURN true; END $$;
CREATE FUNCTION infame_planning_ai_recommendations(v jsonb, minimum integer) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE x jsonb; BEGIN IF NOT infame_planning_ai_array(v,minimum,20) THEN RETURN false; END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(v) LOOP
  IF NOT infame_planning_ai_closed(x,ARRAY['kind','title','body','relatedFields']) OR x->>'kind' IS DISTINCT FROM 'UNVERIFIED_RECOMMENDATION'
   OR NOT infame_planning_ai_text(x->'title',200) OR NOT infame_planning_ai_text(x->'body',2000)
   OR NOT infame_planning_ai_string_array(x->'relatedFields',30,infame_planning_ai_field_keys()) THEN RETURN false; END IF;
 END LOOP; RETURN true; END $$;
CREATE FUNCTION infame_planning_ai_wire(v jsonb, fp jsonb, ordinary_only boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE x jsonb; ref jsonb; seen text[]:=ARRAY[]::text[]; i integer:=1; bases jsonb:='[]'::jsonb;
BEGIN
 IF NOT infame_planning_ai_safe_json(v) OR infame_planning_json_bytes(v)>(CASE WHEN v->>'kind'='COMBINED_REFINEMENT' THEN 262144 ELSE 65536 END) THEN RETURN false; END IF;
 CASE v->>'kind'
 WHEN 'REPLY' THEN
  IF ordinary_only OR NOT infame_planning_ai_closed(v,ARRAY['kind','reply','proposals','recommendations','openQuestions']) OR NOT infame_planning_ai_text(v->'reply',20000)
   OR NOT infame_planning_ai_array(v->'proposals',0,30) OR NOT infame_planning_ai_recommendations(v->'recommendations',0) OR NOT infame_planning_ai_questions(v->'openQuestions') THEN RETURN false; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(v->'proposals') LOOP
   IF NOT infame_planning_ai_closed(x,ARRAY['kind','field','value','source']) OR x->>'kind' IS DISTINCT FROM 'SOURCE_PROPOSAL'
    OR NOT (x->>'field')=ANY(infame_planning_ai_field_keys()) OR (x->>'field')=ANY(seen) OR NOT infame_planning_ai_field_value(x->>'field',x->'value')
    OR NOT infame_planning_ai_closed(x->'source',ARRAY['kind','references']) OR x#>>'{source,kind}' IS DISTINCT FROM 'CUSTOMER_TEXT'
    OR NOT infame_planning_ai_source_refs(x#>'{source,references}',1,4) THEN RETURN false; END IF;
   FOR ref IN SELECT * FROM jsonb_array_elements(x#>'{source,references}') LOOP IF NOT (fp->'sources') @> jsonb_build_array(ref) THEN RETURN false; END IF; END LOOP;
   seen:=array_append(seen,x->>'field');
  END LOOP; RETURN true;
 WHEN 'BRIEF' THEN
  RETURN (infame_planning_ai_closed(v,ARRAY['kind','narrative']) AND infame_planning_ai_closed(v->'narrative',ARRAY['overview','requirementsExplanation','hypotheses','openQuestions'])
   AND infame_planning_ai_text(v#>'{narrative,overview}',20000) AND infame_planning_ai_text(v#>'{narrative,requirementsExplanation}',20000)
   AND infame_planning_ai_questions(v#>'{narrative,hypotheses}') AND infame_planning_ai_questions(v#>'{narrative,openQuestions}')) IS TRUE;
 WHEN 'STRATEGY' THEN
  RETURN (infame_planning_ai_closed(v,ARRAY['kind','summary','audienceApproach','channelApproach','measurementApproach','recommendations','hypotheses','openQuestions'])
   AND infame_planning_ai_text(v->'summary',20000) AND infame_planning_ai_text(v->'audienceApproach',5000) AND infame_planning_ai_text(v->'channelApproach',5000)
   AND infame_planning_ai_text(v->'measurementApproach',5000) AND infame_planning_ai_recommendations(v->'recommendations',1)
   AND infame_planning_ai_questions(v->'hypotheses') AND infame_planning_ai_questions(v->'openQuestions')) IS TRUE;
 WHEN 'IDEAS_PACK' THEN
  IF NOT infame_planning_ai_closed(v,ARRAY['kind','ideas','hypotheses','openQuestions']) OR NOT infame_planning_ai_array(v->'ideas',1,20)
   OR NOT infame_planning_ai_questions(v->'hypotheses') OR NOT infame_planning_ai_questions(v->'openQuestions') THEN RETURN false; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(v->'ideas') LOOP
   IF NOT infame_planning_ai_closed(x,ARRAY['ordinal','title','concept','executionNotes','relatedFields']) OR x->'ordinal' IS DISTINCT FROM to_jsonb(i)
    OR NOT infame_planning_ai_text(x->'title',200) OR NOT infame_planning_ai_text(x->'concept',5000) OR NOT infame_planning_ai_text(x->'executionNotes',2000)
    OR NOT infame_planning_ai_string_array(x->'relatedFields',30,infame_planning_ai_field_keys()) THEN RETURN false; END IF; i:=i+1;
  END LOOP; RETURN true;
 WHEN 'COMBINED_REFINEMENT' THEN
  IF ordinary_only OR NOT infame_planning_ai_closed(v,ARRAY['kind','changes']) OR NOT infame_planning_ai_array(v->'changes',1,3) THEN RETURN false; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(v->'changes') LOOP
   IF NOT infame_planning_ai_closed(x,ARRAY['base','revised']) OR x#>>'{base,kind}' IS DISTINCT FROM x#>>'{revised,kind}'
    OR NOT infame_planning_ai_wire(x->'revised',fp,true) THEN RETURN false; END IF;
   bases:=bases||jsonb_build_array(x->'base');
  END LOOP; RETURN infame_planning_ai_artifacts(bases,1) AND bases IS NOT DISTINCT FROM fp#>'{operation,selectedArtifacts}';
 ELSE RETURN false;
 END CASE;
END $$;
CREATE FUNCTION infame_planning_ai_brief(v jsonb, fp jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE x jsonb;
BEGIN
 IF NOT infame_planning_ai_closed(v,ARRAY['kind','narrative','customerFields','fieldsHash','confirmationBatchId','confirmationBatchHash','binding','snapshot','sources'])
  OR infame_planning_json_bytes(v)>524288 OR fp->'confirmation'='null'::jsonb
  OR NOT infame_planning_ai_wire(jsonb_build_object('kind',v->'kind','narrative',v->'narrative'),fp,true)
  OR NOT infame_planning_ai_fields(v->'customerFields') OR v->'binding' IS DISTINCT FROM fp->'binding' OR v->'snapshot' IS DISTINCT FROM fp->'snapshot'
  OR v->'sources' IS DISTINCT FROM fp->'sources' OR v->'fieldsHash' IS DISTINCT FROM fp#>'{snapshot,fieldsHash}'
  OR v->>'fieldsHash' IS DISTINCT FROM infame_planning_ai_hash(jsonb_build_object('domain','infame-campaign-fields-v1','fields',v->'customerFields'))
  OR v->'confirmationBatchId' IS DISTINCT FROM fp#>'{confirmation,batchId}' OR v->'confirmationBatchHash' IS DISTINCT FROM fp#>'{confirmation,batchHash}' THEN RETURN false; END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(fp#>'{confirmation,fields}') LOOP
  IF x->>'valueHash' IS DISTINCT FROM infame_planning_ai_hash(jsonb_build_object('domain','infame-campaign-field-value-v1','field',x->'field','value',v#>ARRAY['customerFields',x->>'field'])) THEN RETURN false; END IF;
 END LOOP; RETURN true;
END $$;
-- Return only the normalized strict provider body. Nothing resembling server
-- enrichment can leak into its hash, and all retained enrichment is checked first.
CREATE FUNCTION infame_planning_ai_retained_wire(v jsonb, fp jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE out jsonb; x jsonb; changes jsonb:='[]'::jsonb; revised jsonb; bases jsonb:='[]'::jsonb;
BEGIN
 IF NOT infame_planning_ai_safe_json(v) OR infame_planning_json_bytes(v)>524288
 OR NOT infame_planning_ai_closed(v,ARRAY['schemaVersion','attemptId','operationId','sessionId','binding','snapshot','scopeFingerprintHash','provider','output'])
 OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR NOT infame_planning_ai_jid(v->'attemptId') OR v->'operationId' IS DISTINCT FROM fp#>'{operation,id}'
 OR v->'sessionId' IS DISTINCT FROM fp->'sessionId' OR v->'binding' IS DISTINCT FROM fp->'binding' OR v->'snapshot' IS DISTINCT FROM fp->'snapshot'
 OR v->>'scopeFingerprintHash' IS DISTINCT FROM infame_planning_ai_hash(jsonb_build_object('domain','infame-planning-scope-v1')||fp)
 OR NOT infame_planning_ai_closed(v->'provider',ARRAY['id','modelId','registryVersion','requestId']) OR v#>>'{provider,id}' IS DISTINCT FROM 'ANTHROPIC'
 OR NOT infame_planning_ai_jid(v#>'{provider,modelId}') OR NOT infame_planning_ai_jid(v#>'{provider,registryVersion}')
 OR NOT infame_planning_ai_reference(v#>>'{provider,registryVersion}') OR NOT infame_planning_ai_jid(v#>'{provider,requestId}',true)
 OR v#>'{output,kind}' IS DISTINCT FROM fp#>'{operation,kind}' THEN RETURN NULL; END IF;
 out:=v->'output';
 IF out->>'kind'='BRIEF' THEN
  IF NOT infame_planning_ai_brief(out,fp) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('kind','BRIEF','narrative',out->'narrative');
 ELSIF out->>'kind'='COMBINED_REFINEMENT' THEN
  IF NOT infame_planning_ai_closed(out,ARRAY['kind','changes']) OR NOT infame_planning_ai_array(out->'changes',1,3) THEN RETURN NULL; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(out->'changes') LOOP
   IF NOT infame_planning_ai_closed(x,ARRAY['base','revised']) OR x#>'{base,kind}' IS DISTINCT FROM x#>'{revised,kind}' THEN RETURN NULL; END IF;
   revised:=x->'revised';
   IF revised->>'kind'='BRIEF' THEN
    IF NOT infame_planning_ai_brief(revised,fp) THEN RETURN NULL; END IF; revised:=jsonb_build_object('kind','BRIEF','narrative',revised->'narrative');
   ELSIF NOT infame_planning_ai_wire(revised,fp,true) THEN RETURN NULL;
   END IF;
   bases:=bases||jsonb_build_array(x->'base'); changes:=changes||jsonb_build_array(jsonb_build_object('base',x->'base','revised',revised));
  END LOOP;
  IF NOT infame_planning_ai_artifacts(bases,1) OR bases IS DISTINCT FROM fp#>'{operation,selectedArtifacts}' THEN RETURN NULL; END IF;
  out:=jsonb_build_object('kind','COMBINED_REFINEMENT','changes',changes);
 END IF;
 IF NOT infame_planning_ai_wire(out,fp) THEN RETURN NULL; END IF;
 RETURN out;
END $$;
CREATE FUNCTION infame_planning_ai_safe_json(v jsonb, depth integer DEFAULT 0) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE p record; x jsonb;
BEGIN
 IF v IS NULL OR depth>12 THEN RETURN false; END IF;
 IF jsonb_typeof(v)='object' THEN
   FOR p IN SELECT * FROM jsonb_each(v) LOOP
     IF p.key=ANY(ARRAY['__proto__','prototype','constructor']) OR NOT infame_planning_ai_safe_json(p.value,depth+1) THEN RETURN false; END IF;
   END LOOP;
 ELSIF jsonb_typeof(v)='array' THEN
   FOR x IN SELECT * FROM jsonb_array_elements(v) LOOP IF NOT infame_planning_ai_safe_json(x,depth+1) THEN RETURN false; END IF; END LOOP;
 ELSIF jsonb_typeof(v)='number' THEN
   IF v::text IN ('NaN','Infinity','-Infinity') OR abs(v::text::numeric)>1.7976931348623157e308 THEN RETURN false; END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN numeric_value_out_of_range THEN RETURN false; END $$;

-- ECMA402 structural language grammar; retain spelling, never infer/normalize it.
-- See companion notes: runtime ICU grandfathered-tag parity remains a review item.
CREATE FUNCTION infame_planning_ai_language(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text; parts text[]; part text; variants text[]:=ARRAY[]::text[]; singletons text[]:=ARRAY[]::text[]; i int:=2; n int;
BEGIN
 IF v='null'::jsonb THEN RETURN true; END IF;
 IF jsonb_typeof(v) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 s:=v#>>'{}'; IF length(s) NOT BETWEEN 2 AND 100 OR s !~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$' THEN RETURN false; END IF;
 parts:=string_to_array(lower(s),'-'); n:=array_length(parts,1);
 IF parts[1] !~ '^([a-z]{2,3}|[a-z]{5,8})$' THEN RETURN false; END IF;
 IF i<=n AND parts[i] ~ '^[a-z]{4}$' THEN i:=i+1; END IF;
 IF i<=n AND parts[i] ~ '^([a-z]{2}|[0-9]{3})$' THEN i:=i+1; END IF;
 WHILE i<=n AND parts[i] ~ '^([a-z0-9]{5,8}|[0-9][a-z0-9]{3})$' LOOP
   IF parts[i]=ANY(variants) THEN RETURN false; END IF; variants:=array_append(variants,parts[i]); i:=i+1;
 END LOOP;
 WHILE i<=n AND parts[i] ~ '^[0-9a-wy-z]$' LOOP
   part:=parts[i]; IF part=ANY(singletons) THEN RETURN false; END IF; singletons:=array_append(singletons,part); i:=i+1;
   IF i>n OR parts[i] !~ '^[a-z0-9]{2,8}$' THEN RETURN false; END IF;
   WHILE i<=n AND parts[i] ~ '^[a-z0-9]{2,8}$' LOOP i:=i+1; END LOOP;
 END LOOP;
 IF i<=n AND parts[i]='x' THEN
   i:=i+1; IF i>n THEN RETURN false; END IF;
   WHILE i<=n AND parts[i] ~ '^[a-z0-9]{1,8}$' LOOP i:=i+1; END LOOP;
 END IF;
 RETURN i>n;
END $$;
CREATE FUNCTION infame_planning_ai_text(v jsonb, maximum integer) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT (infame_planning_ai_closed(v,ARRAY['text','language']) AND jsonb_typeof(v->'text')='string'
 AND infame_planning_ai_utf16_length(v->>'text') BETWEEN 1 AND maximum AND (v->>'text') !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
 AND infame_planning_ai_utf16_length(infame_planning_ai_trim(v->>'text'))>0 AND infame_planning_ai_language(v->'language')) IS TRUE $$;
CREATE FUNCTION infame_planning_ai_array(v jsonb, minimum integer, maximum integer) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN IF jsonb_typeof(v) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 RETURN jsonb_array_length(v) BETWEEN minimum AND maximum; END $$;
CREATE FUNCTION infame_planning_ai_source_refs(v jsonb, minimum integer, maximum integer) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE x jsonb; previous text;
BEGIN
 IF NOT infame_planning_ai_array(v,minimum,maximum) THEN RETURN false; END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(v) LOOP
   IF NOT infame_planning_ai_closed(x,ARRAY['id','sourceHash']) OR NOT infame_planning_ai_jid(x->'id') OR NOT infame_planning_ai_jhash(x->'sourceHash')
      OR (previous IS NOT NULL AND previous COLLATE "C">=(x->>'id') COLLATE "C") THEN RETURN false; END IF;
   previous:=x->>'id';
 END LOOP; RETURN true;
END $$;
CREATE FUNCTION infame_planning_ai_artifacts(v jsonb, minimum integer DEFAULT 0) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE x jsonb; ids text[]:=ARRAY[]::text[]; previous int:=0; rank int;
BEGIN
 IF NOT infame_planning_ai_array(v,minimum,3) THEN RETURN false; END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(v) LOOP
   rank:=array_position(ARRAY['BRIEF','STRATEGY','IDEAS_PACK'],x->>'kind');
   IF NOT infame_planning_ai_closed(x,ARRAY['id','kind','contentHash']) OR NOT infame_planning_ai_jid(x->'id')
     OR NOT infame_planning_ai_jhash(x->'contentHash') OR rank IS NULL OR rank<=previous OR (x->>'id')=ANY(ids) THEN RETURN false; END IF;
   previous:=rank; ids:=array_append(ids,x->>'id');
 END LOOP; RETURN true;
END $$;
CREATE FUNCTION infame_planning_ai_binding(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT (infame_planning_ai_closed(v,ARRAY['scope','workspaceId','campaignId']) AND infame_planning_ai_jid(v->'workspaceId') AND infame_planning_ai_jid(v->'campaignId')
 AND ((v#>>'{scope,kind}'='OWN_BRAND' AND infame_planning_ai_closed(v->'scope',ARRAY['kind','brandId']) AND infame_planning_ai_jid(v#>'{scope,brandId}'))
   OR (v#>>'{scope,kind}'='CLIENT' AND infame_planning_ai_closed(v->'scope',ARRAY['kind','clientId']) AND infame_planning_ai_jid(v#>'{scope,clientId}')))) IS TRUE $$;
CREATE FUNCTION infame_planning_ai_snapshot(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT (infame_planning_ai_closed(v,ARRAY['campaignRevision','fieldsRevision','planningRevision','selection','fieldsHash'])
 AND infame_planning_ai_jint(v->'campaignRevision',1,2147483646) AND infame_planning_ai_jint(v->'fieldsRevision',1,2147483646)
 AND infame_planning_ai_jint(v->'planningRevision',1,2147483646) AND (v->>'fieldsRevision')::numeric<=(v->>'campaignRevision')::numeric
 AND infame_planning_ai_jhash(v->'fieldsHash') AND infame_planning_ai_closed(v->'selection',ARRAY['id','revision','kind','versionId','contentHash'])
 AND infame_planning_ai_jid(v#>'{selection,id}') AND infame_planning_ai_jint(v#>'{selection,revision}',1,2147483646)
 AND ((v#>>'{selection,kind}'='NONE' AND v#>'{selection,versionId}'='null'::jsonb AND v#>'{selection,contentHash}'='null'::jsonb)
  OR (v#>>'{selection,kind}'='APPROVED_CONTEXT' AND infame_planning_ai_jid(v#>'{selection,versionId}') AND infame_planning_ai_jhash(v#>'{selection,contentHash}')))) IS TRUE $$;
CREATE FUNCTION infame_planning_ai_authority(v jsonb, capability text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text;
BEGIN
 IF NOT infame_planning_ai_closed(v,ARRAY['organizationId','clientId','brandId','membershipId','grantId','capability','organizationRevision','membershipRevision','clientRevision','grantRevision'])
   OR v->>'capability' IS DISTINCT FROM capability THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['organizationId','clientId','brandId','membershipId','grantId'] LOOP IF NOT infame_planning_ai_jid(v->k) THEN RETURN false; END IF; END LOOP;
 FOREACH k IN ARRAY ARRAY['organizationRevision','membershipRevision','clientRevision','grantRevision'] LOOP IF NOT infame_planning_ai_jint(v->k,1,2147483646) THEN RETURN false; END IF; END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION infame_planning_ai_field_keys() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[
 'originalLanguage','title','productService','goal','summary','marketCountryCodes','targetAgeBuckets','targetGenders','targetCountryCodes','targetCityKeys',
 'contentLanguages','dialects','nicheSlugs','deliverables','budget','desiredCreatorCount','impressionsTarget','period','physicalPresenceRequired','presenceCountryCodes',
 'travelAllowed','tone','noGoTopics','preferredTiers','dataVerificationRequired','preferredLicencePolicyIds','usageRights','kpis','assumptions','openQuestions'] $$;
CREATE FUNCTION infame_planning_ai_fingerprint(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE x jsonb; pins jsonb; i int:=1; ids text[]:=ARRAY[]::text[]; k text; selection jsonb; needs_confirmation boolean;
BEGIN
 IF NOT infame_planning_ai_safe_json(v) OR infame_planning_json_bytes(v)>65536
 OR NOT infame_planning_ai_closed(v,ARRAY['schemaVersion','binding','brandId','organizationId','clientId','actor','brandOwner','authority','pool','enrollment','seat','cycle','sessionId','operation','agent','snapshot','context','sources','confirmation'])
 OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR NOT infame_planning_ai_binding(v->'binding') OR NOT infame_planning_ai_snapshot(v->'snapshot')
 OR NOT infame_planning_ai_jid(v->'brandId') OR NOT infame_planning_ai_jid(v->'organizationId',true) OR NOT infame_planning_ai_jid(v->'clientId',true)
 OR NOT infame_planning_ai_jid(v->'sessionId') OR NOT infame_planning_ai_source_refs(v->'sources',0,64)
 OR NOT infame_planning_ai_closed(v->'actor',ARRAY['userId','role','sessionVersion']) OR v#>>'{actor,role}' IS DISTINCT FROM 'BRAND'
 OR NOT infame_planning_ai_jid(v#>'{actor,userId}') OR NOT infame_planning_ai_jint(v#>'{actor,sessionVersion}',1,2147483647)
 OR NOT infame_planning_ai_closed(v->'brandOwner',ARRAY['userId','sessionVersion']) OR NOT infame_planning_ai_jid(v#>'{brandOwner,userId}')
 OR NOT infame_planning_ai_jint(v#>'{brandOwner,sessionVersion}',1,2147483647)
 OR NOT infame_planning_ai_closed(v->'pool',ARRAY['id','scope','brandId','organizationId']) OR NOT infame_planning_ai_jid(v#>'{pool,id}')
 OR jsonb_typeof(v#>'{pool,scope}') IS DISTINCT FROM 'string' OR (v#>>'{pool,scope}' IN ('OWN_BRAND','CLIENT')) IS NOT TRUE
 OR NOT infame_planning_ai_jid(v#>'{pool,brandId}',true) OR NOT infame_planning_ai_jid(v#>'{pool,organizationId}',true)
 OR NOT infame_planning_ai_closed(v->'enrollment',ARRAY['id','revision','subscriberUserId']) OR NOT infame_planning_ai_jid(v#>'{enrollment,id}')
 OR NOT infame_planning_ai_jid(v#>'{enrollment,subscriberUserId}') OR NOT infame_planning_ai_jint(v#>'{enrollment,revision}',1,2147483646)
 OR NOT infame_planning_ai_closed(v->'seat',ARRAY['id','userId','revision','membershipId']) OR NOT infame_planning_ai_jid(v#>'{seat,id}')
 OR NOT infame_planning_ai_jid(v#>'{seat,userId}') OR NOT infame_planning_ai_jid(v#>'{seat,membershipId}',true) OR NOT infame_planning_ai_jint(v#>'{seat,revision}',1,2147483646)
 OR v#>'{seat,userId}' IS DISTINCT FROM v#>'{actor,userId}'
 OR NOT infame_planning_ai_closed(v->'cycle',ARRAY['id','startsAt','endsAt','planId','policyVersion','priceVersion']) OR NOT infame_planning_ai_jid(v#>'{cycle,id}')
 OR NOT infame_planning_ai_utc(v#>'{cycle,startsAt}') OR NOT infame_planning_ai_utc(v#>'{cycle,endsAt}')
 OR (v#>>'{cycle,startsAt}')::timestamp(3)>=(v#>>'{cycle,endsAt}')::timestamp(3)
 OR jsonb_typeof(v#>'{cycle,planId}') IS DISTINCT FROM 'string' OR (v#>>'{cycle,planId}' IN ('TRIAL','STARTER','GROWTH','PRO')) IS NOT TRUE OR v#>>'{cycle,policyVersion}' IS DISTINCT FROM 'infame-commercial-v1-2026-10-05'
 OR (CASE WHEN v#>>'{cycle,planId}'='TRIAL' THEN v#>'{cycle,priceVersion}'='null'::jsonb ELSE infame_planning_ai_jid(v#>'{cycle,priceVersion}') AND infame_planning_ai_reference(v#>>'{cycle,priceVersion}') END) IS NOT TRUE
 OR NOT infame_planning_ai_closed(v->'operation',ARRAY['id','kind','ordinal','selectedArtifacts']) OR NOT infame_planning_ai_jid(v#>'{operation,id}')
 OR NOT infame_planning_ai_jint(v#>'{operation,ordinal}',1,10) OR jsonb_typeof(v#>'{operation,kind}') IS DISTINCT FROM 'string'
 OR (v#>>'{operation,kind}' IN ('REPLY','BRIEF','STRATEGY','IDEAS_PACK','COMBINED_REFINEMENT')) IS NOT TRUE
 OR (v#>>'{operation,kind}'<>'REPLY' AND v#>'{operation,ordinal}'<>'1'::jsonb)
 OR NOT infame_planning_ai_artifacts(v#>'{operation,selectedArtifacts}',CASE WHEN v#>>'{operation,kind}'='COMBINED_REFINEMENT' THEN 1 ELSE 0 END)
 OR (v#>>'{operation,kind}'<>'COMBINED_REFINEMENT' AND v#>'{operation,selectedArtifacts}'<>'[]'::jsonb)
 OR NOT infame_planning_ai_closed(v->'agent',ARRAY['id','revision','stateHash']) OR NOT infame_planning_ai_jid(v#>'{agent,id}')
 OR NOT infame_planning_ai_jint(v#>'{agent,revision}',1,2147483646) OR NOT infame_planning_ai_jhash(v#>'{agent,stateHash}') THEN RETURN false; END IF;
 IF v#>>'{binding,scope,kind}'='OWN_BRAND' THEN
  IF v->'organizationId'<>'null'::jsonb OR v->'clientId'<>'null'::jsonb OR v->'authority'<>'null'::jsonb OR v#>'{seat,membershipId}'<>'null'::jsonb
   OR v#>'{binding,scope,brandId}'<>v->'brandId' OR v#>'{actor,userId}'<>v#>'{brandOwner,userId}' OR v#>'{actor,sessionVersion}'<>v#>'{brandOwner,sessionVersion}'
   OR v#>>'{pool,scope}'<>'OWN_BRAND' OR v#>'{pool,brandId}'<>v->'brandId' OR v#>'{pool,organizationId}'<>'null'::jsonb THEN RETURN false; END IF;
 ELSE
  IF NOT infame_planning_ai_closed(v->'authority',ARRAY['view','plan']) OR NOT infame_planning_ai_authority(v#>'{authority,view}','view')
   OR NOT infame_planning_ai_authority(v#>'{authority,plan}','plan') OR (v#>'{authority,view}'-'capability')<>(v#>'{authority,plan}'-'capability')
   OR NOT infame_planning_ai_jid(v->'organizationId') OR NOT infame_planning_ai_jid(v->'clientId') OR v#>'{binding,scope,clientId}'<>v->'clientId'
   OR v#>>'{pool,scope}'<>'CLIENT' OR v#>'{pool,brandId}'<>'null'::jsonb OR v#>'{pool,organizationId}'<>v->'organizationId'
   OR v#>'{authority,plan,organizationId}'<>v->'organizationId' OR v#>'{authority,plan,clientId}'<>v->'clientId'
   OR v#>'{authority,plan,brandId}'<>v->'brandId' OR v#>'{authority,plan,membershipId}'<>v#>'{seat,membershipId}' THEN RETURN false; END IF;
 END IF;
 selection:=v#>'{snapshot,selection}';
 IF selection->>'kind'='NONE' THEN IF v->'context'<>'null'::jsonb THEN RETURN false; END IF;
 ELSE
   IF NOT infame_planning_ai_closed(v->'context',ARRAY['contextId','versionId','version','versionInputRevision','contentHash','submissionId']) THEN RETURN false; END IF;
   FOREACH k IN ARRAY ARRAY['contextId','versionId','submissionId'] LOOP IF NOT infame_planning_ai_jid(v#>ARRAY['context',k]) THEN RETURN false; END IF; END LOOP;
   IF NOT infame_planning_ai_jint(v#>'{context,version}',1,2147483646) OR NOT infame_planning_ai_jint(v#>'{context,versionInputRevision}',1,2147483646)
     OR NOT infame_planning_ai_jhash(v#>'{context,contentHash}') OR v#>'{context,versionId}'<>selection->'versionId' OR v#>'{context,contentHash}'<>selection->'contentHash' THEN RETURN false; END IF;
 END IF;
 needs_confirmation:=v#>>'{operation,kind}'='BRIEF' OR EXISTS(SELECT 1 FROM jsonb_array_elements(v#>'{operation,selectedArtifacts}') a WHERE a->>'kind'='BRIEF');
 IF v->'confirmation'='null'::jsonb THEN RETURN NOT needs_confirmation; END IF;
 x:=v->'confirmation'; pins:=x->'fields';
 IF NOT infame_planning_ai_closed(x,ARRAY['batchId','batchHash','reviewedSnapshot','fields']) OR NOT infame_planning_ai_jid(x->'batchId')
 OR NOT infame_planning_ai_jhash(x->'batchHash') OR x->'reviewedSnapshot' IS DISTINCT FROM v->'snapshot' OR NOT infame_planning_ai_array(pins,30,30) THEN RETURN false; END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(pins) LOOP
   IF NOT infame_planning_ai_closed(x,ARRAY['field','id','valueHash','confirmationHash']) OR x->>'field' IS DISTINCT FROM (infame_planning_ai_field_keys())[i]
     OR NOT infame_planning_ai_jid(x->'id') OR NOT infame_planning_ai_jhash(x->'valueHash') OR NOT infame_planning_ai_jhash(x->'confirmationHash') OR (x->>'id')=ANY(ids) THEN RETURN false; END IF;
   ids:=array_append(ids,x->>'id'); i:=i+1;
 END LOOP; RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN false; END $$;
CREATE FUNCTION infame_planning_ai_request(v jsonb, fp jsonb, actor_id text, operation_key uuid, fp_hash text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 RETURN (infame_planning_ai_safe_json(v) AND infame_planning_json_bytes(v)<=16384
  AND infame_planning_ai_closed(v,ARRAY['schemaVersion','operationKey','sessionId','kind','ordinal','expectedFingerprintHash','sourceMessage','requestedLanguage','selectedArtifacts'])
  AND v->'schemaVersion'='1'::jsonb AND jsonb_typeof(v->'operationKey')='string'
  AND (v->>'operationKey') ~* '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
  AND (v->>'operationKey')::uuid=operation_key AND v->'sessionId'=fp->'sessionId'
  AND v->'kind'=fp#>'{operation,kind}' AND v->'ordinal'=fp#>'{operation,ordinal}' AND v->>'expectedFingerprintHash'=fp_hash
  AND infame_planning_ai_language(v->'requestedLanguage') AND v->'selectedArtifacts'=fp#>'{operation,selectedArtifacts}'
  AND (v->'sourceMessage'='null'::jsonb OR EXISTS(SELECT 1 FROM jsonb_array_elements(fp->'sources') x WHERE x=v->'sourceMessage'))
  AND (v->>'kind' NOT IN ('REPLY','COMBINED_REFINEMENT') OR v->'sourceMessage'<>'null'::jsonb)) IS TRUE;
EXCEPTION WHEN invalid_text_representation THEN RETURN false; END $$;

CREATE FUNCTION infame_planning_ai_pricing(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE x jsonb; units text[]:=ARRAY[]::text[]; as_of date;
BEGIN
 IF NOT infame_planning_ai_safe_json(v) OR infame_planning_json_bytes(v)>4096 OR NOT infame_planning_ai_closed(v,ARRAY['version','modelId','asOf','currency','prices'])
 OR jsonb_typeof(v->'version') IS DISTINCT FROM 'string' OR NOT infame_planning_ai_ledger_id(v->>'version')
 OR jsonb_typeof(v->'modelId') IS DISTINCT FROM 'string' OR NOT infame_planning_ai_ledger_id(v->>'modelId')
 OR jsonb_typeof(v->'asOf') IS DISTINCT FROM 'string' OR v->>'asOf' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 OR v->>'currency' IS DISTINCT FROM 'USD' OR NOT infame_planning_ai_array(v->'prices',1,6) THEN RETURN false; END IF;
 as_of:=(v->>'asOf')::date; IF to_char(as_of,'YYYY-MM-DD')<>v->>'asOf' THEN RETURN false; END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(v->'prices') LOOP
   IF NOT infame_planning_ai_closed(x,ARRAY['unit','quantity','priceMicros']) OR jsonb_typeof(x->'unit') IS DISTINCT FROM 'string'
    OR (x->>'unit' IN ('INPUT_TOKENS','OUTPUT_TOKENS','INPUT_AUDIO_MILLISECONDS','OUTPUT_AUDIO_MILLISECONDS','IMAGES','REQUESTS')) IS NOT TRUE
    OR (x->>'unit')=ANY(units) OR NOT infame_planning_ai_minor(x->'quantity',true) OR NOT infame_planning_ai_minor(x->'priceMicros') THEN RETURN false; END IF;
   units:=array_append(units,x->>'unit');
 END LOOP; RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false; END $$;

-- Native retained records. All identities/claims are frozen by the BEFORE guard.
ALTER TABLE "PlanningAiOperation" ADD CONSTRAINT "PlanningAiOperation_id_sessionId_key" UNIQUE(id,"sessionId");
CREATE TABLE "PlanningAiAttempt" (
 id text PRIMARY KEY, "operationId" text NOT NULL, "sessionId" text NOT NULL, "poolId" text NOT NULL,
 "seatId" text NOT NULL, "actorUserId" text NOT NULL, "actorRole" text NOT NULL, "actorSessionVersion" integer NOT NULL,
 "operationKey" uuid NOT NULL, sequence integer NOT NULL, request jsonb NOT NULL, "requestHash" text NOT NULL,
 "scopeFingerprint" jsonb NOT NULL, "scopeFingerprintHash" text NOT NULL, "payloadHash" text NOT NULL,
 "ledgerRequestHash" text NOT NULL, "pricingHash" text NOT NULL, "reservationId" text NOT NULL,
 "ledgerOperationKey" text NOT NULL, "ledgerPurpose" text NOT NULL, pricing jsonb NOT NULL, "reservedMicros" bigint NOT NULL,
 "executionTimeoutMs" integer NOT NULL, "executionTokenHash" text NOT NULL, "claimedAt" timestamp(3) NOT NULL,
 "deadlineAt" timestamp(3) NOT NULL, "registryVersion" text NOT NULL, state text NOT NULL,
 "knownFailureEvidenceJson" jsonb, "executionEvidenceJson" jsonb, "providerRequestId" text, revision integer NOT NULL DEFAULT 1,
 "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), "updatedAt" timestamp(3) NOT NULL,
 CONSTRAINT "PlanningAiAttempt_shape" CHECK ((
  id COLLATE "C" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND infame_planning_ai_id("operationId") AND infame_planning_ai_id("sessionId") AND infame_planning_ai_id("poolId")
  AND infame_planning_ai_id("seatId") AND infame_planning_ai_id("actorUserId") AND "actorRole"='BRAND'
  AND "actorSessionVersion" BETWEEN 1 AND 2147483647 AND sequence BETWEEN 1 AND 2147483646 AND revision BETWEEN 1 AND 2147483646
  AND "requestHash" ~ '^[a-f0-9]{64}$' AND "scopeFingerprintHash" ~ '^[a-f0-9]{64}$' AND "payloadHash" ~ '^[a-f0-9]{64}$'
  AND "ledgerRequestHash" ~ '^[a-f0-9]{64}$' AND "pricingHash" ~ '^[a-f0-9]{64}$' AND "executionTokenHash" ~ '^[a-f0-9]{64}$'
  AND infame_planning_ai_ledger_id("reservationId") AND infame_planning_ai_ledger_id("ledgerOperationKey")
  AND "ledgerPurpose" IN ('CAMPAIGN_CHAT','BRIEF','CONTENT_THEME') AND "reservedMicros">0 AND "executionTimeoutMs" BETWEEN 1000 AND 300000
  AND infame_planning_ai_reference("registryVersion") AND ("providerRequestId" IS NULL OR infame_planning_ai_id("providerRequestId"))
  AND isfinite("claimedAt") AND isfinite("deadlineAt") AND "deadlineAt">"claimedAt"
  AND "deadlineAt"="claimedAt"+"executionTimeoutMs"*interval '1 millisecond'
  AND isfinite("createdAt") AND isfinite("updatedAt") AND "updatedAt">="createdAt"
  AND state IN ('RUNNING','UNKNOWN','FAILED_KNOWN','RESULT_RECORDED')
  AND ((state='FAILED_KNOWN' AND "knownFailureEvidenceJson" IS NOT NULL AND "executionEvidenceJson" IS NOT NULL)
    OR (state<>'FAILED_KNOWN' AND "knownFailureEvidenceJson" IS NULL))
  AND (state<>'RESULT_RECORDED' OR "executionEvidenceJson" IS NOT NULL)
  AND infame_planning_json_bytes(request)<=16384 AND infame_planning_json_bytes("scopeFingerprint")<=65536
  AND infame_planning_json_bytes(pricing)<=4096
  AND ("executionEvidenceJson" IS NULL OR infame_planning_json_bytes("executionEvidenceJson")<=2048)
  AND ("knownFailureEvidenceJson" IS NULL OR infame_planning_json_bytes("knownFailureEvidenceJson")<=4096)
 ) IS TRUE),
 CONSTRAINT "PlanningAiAttempt_actorUserId_operationKey_key" UNIQUE("actorUserId","operationKey"),
 CONSTRAINT "PlanningAiAttempt_operationId_sequence_key" UNIQUE("operationId",sequence),
 CONSTRAINT "PlanningAiAttempt_reservationId_key" UNIQUE("reservationId"),
 CONSTRAINT "PlanningAiAttempt_result_identity" UNIQUE(id,"operationId","sessionId","poolId"),
 CONSTRAINT "PlanningAiAttempt_operation" FOREIGN KEY ("operationId","sessionId") REFERENCES "PlanningAiOperation"(id,"sessionId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "PlanningAiAttempt_session" FOREIGN KEY ("sessionId","poolId") REFERENCES "PlanningAiSession"(id,"poolId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "PlanningAiAttempt_actor_seat" FOREIGN KEY ("seatId","poolId","actorUserId") REFERENCES "PlanningAiSeat"(id,"poolId","userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "PlanningAiAttempt_actor" FOREIGN KEY ("actorUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "PlanningAiAttempt_reservation" FOREIGN KEY ("reservationId") REFERENCES "AiReservation"(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "PlanningAiAttempt_one_unresolved_operation" ON "PlanningAiAttempt"("operationId") WHERE state IN ('RUNNING','UNKNOWN');
CREATE INDEX "PlanningAiAttempt_operationId_sessionId_idx" ON "PlanningAiAttempt"("operationId","sessionId");
CREATE INDEX "PlanningAiAttempt_sessionId_poolId_state_idx" ON "PlanningAiAttempt"("sessionId","poolId",state);
CREATE INDEX "PlanningAiAttempt_acting_seat" ON "PlanningAiAttempt"("seatId","poolId","actorUserId");
CREATE TABLE "PlanningAiResult" (
 id text PRIMARY KEY, "attemptId" text NOT NULL, "operationId" text NOT NULL, "sessionId" text NOT NULL, "poolId" text NOT NULL,
 disposition text NOT NULL, "outputHash" text NOT NULL, "wireHash" text, "providerRequestId" text,
 content jsonb, "contentHash" text, "reasonCode" text, "terminalEvidenceJson" jsonb NOT NULL,
 "createdAt" timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
 CONSTRAINT "PlanningAiResult_shape" CHECK ((infame_planning_ai_id(id) AND infame_planning_ai_id("attemptId")
  AND infame_planning_ai_id("operationId") AND infame_planning_ai_id("sessionId") AND infame_planning_ai_id("poolId")
  AND "outputHash" ~ '^[a-f0-9]{64}$' AND ("providerRequestId" IS NULL OR infame_planning_ai_id("providerRequestId")) AND isfinite("createdAt")
  AND infame_planning_json_bytes("terminalEvidenceJson")<=4096 AND (
   (disposition='ATTACHED' AND content IS NOT NULL AND "contentHash" ~ '^[a-f0-9]{64}$' AND "wireHash" ~ '^[a-f0-9]{64}$' AND "reasonCode" IS NULL)
   OR (content IS NULL AND "contentHash" IS NULL AND "wireHash" IS NULL AND (
    (disposition='DENIED' AND "reasonCode" IN ('AUTH_UNAVAILABLE','SCOPE_UNAVAILABLE','SEAT_INELIGIBLE','ENTITLEMENT_INACTIVE','CYCLE_EXPIRED'))
    OR (disposition='STALE' AND "reasonCode" IN ('AUTHORITY_CHANGED','SNAPSHOT_CHANGED','AGENT_CHANGED','SOURCE_CHANGED','CONFIRMATION_CHANGED','ARTIFACT_BASE_CHANGED'))
    OR (disposition='INVALID' AND "reasonCode" IN ('MALFORMED_OUTPUT','OUTPUT_TOO_LARGE','WRONG_KIND','INVALID_FIELD_VALUE','SOURCE_REFERENCE_MISMATCH','INVALID_ARTIFACT_SET','INVALID_LANGUAGE','REFUSAL','TRUNCATED_OUTPUT','PAUSED_OUTPUT')))))
 ) IS TRUE),
 CONSTRAINT "PlanningAiResult_attemptId_key" UNIQUE("attemptId"),
 CONSTRAINT "PlanningAiResult_operation_identity" UNIQUE(id,"operationId","sessionId"),
 CONSTRAINT "PlanningAiResult_session_identity" UNIQUE(id,"sessionId","poolId"),
 CONSTRAINT "PlanningAiResult_exact_attempt" FOREIGN KEY ("attemptId","operationId","sessionId","poolId")
  REFERENCES "PlanningAiAttempt"(id,"operationId","sessionId","poolId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "PlanningAiResult_one_attached_operation" ON "PlanningAiResult"("operationId") WHERE disposition='ATTACHED';
CREATE INDEX "PlanningAiResult_sessionId_poolId_idx" ON "PlanningAiResult"("sessionId","poolId");
CREATE INDEX "PlanningAiResult_attempt_identity" ON "PlanningAiResult"("attemptId","operationId","sessionId","poolId");
CREATE INDEX "PlanningAiResult_operationId_idx" ON "PlanningAiResult"("operationId");
ALTER TABLE "PlanningAiSession" ADD CONSTRAINT "PlanningAiSession_first_result"
 FOREIGN KEY ("firstAttachedResultId",id,"poolId") REFERENCES "PlanningAiResult"(id,"sessionId","poolId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PlanningAiOperation" ADD CONSTRAINT "PlanningAiOperation_successful_result"
 FOREIGN KEY ("successfulResultId",id,"sessionId") REFERENCES "PlanningAiResult"(id,"operationId","sessionId") ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION infame_planning_ai_execution(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT (infame_planning_ai_safe_json(v) AND infame_planning_json_bytes(v)<=2048
 AND infame_planning_ai_closed(v,ARRAY['executionBasis','reference','evidenceHash','resolvedAt','reservationId'])
 AND v->>'executionBasis' IN ('TRUSTED_PRE_CALL_STOP','PROVIDER_CONFIRMED_NO_CALL','PROVIDER_TERMINAL_RESPONSE','REVIEWED_EXECUTION_RESOLUTION')
 AND infame_planning_ai_jid(v->'reference') AND infame_planning_ai_reference(v->>'reference')
 AND infame_planning_ai_jhash(v->'evidenceHash') AND infame_planning_ai_utc(v->'resolvedAt') AND infame_planning_ai_jid(v->'reservationId')) IS TRUE $$;
CREATE FUNCTION infame_planning_ai_terminal(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE b jsonb;
BEGIN
 IF NOT infame_planning_ai_safe_json(v) OR infame_planning_json_bytes(v)>4096
 OR NOT infame_planning_ai_closed(v,ARRAY['executionBasis','reference','evidenceHash','resolvedAt','reservationId','billingBasis'])
 OR NOT infame_planning_ai_execution(v-'billingBasis') THEN RETURN false; END IF;
 b:=v->'billingBasis';
 IF b->>'kind'='RELEASED' THEN
  IF NOT infame_planning_ai_closed(b,ARRAY['kind','noCallReason']) OR jsonb_typeof(b->'noCallReason') IS DISTINCT FROM 'string'
   OR (b->>'noCallReason' IN ('FAILED_BEFORE_INVOCATION','PROVIDER_CONFIRMED_NO_CALL','RECONCILED_NO_CHARGE')) IS NOT TRUE THEN RETURN false; END IF;
 ELSIF b->>'kind'='SETTLED' THEN
  IF NOT infame_planning_ai_closed(b,ARRAY['kind','settlementHash','actualMicros']) OR NOT infame_planning_ai_jhash(b->'settlementHash') OR NOT infame_planning_ai_minor(b->'actualMicros') THEN RETURN false; END IF;
 ELSE RETURN false;
 END IF;
 RETURN (CASE v->>'executionBasis'
 WHEN 'TRUSTED_PRE_CALL_STOP' THEN b->>'kind'='RELEASED' AND b->>'noCallReason'='FAILED_BEFORE_INVOCATION'
 WHEN 'PROVIDER_CONFIRMED_NO_CALL' THEN b->>'kind'='RELEASED' AND b->>'noCallReason'='PROVIDER_CONFIRMED_NO_CALL'
 WHEN 'PROVIDER_TERMINAL_RESPONSE' THEN b->>'kind'='SETTLED' ELSE true END) IS TRUE;
END $$;
CREATE FUNCTION infame_planning_ai_evidence_native(v jsonb, attempt "PlanningAiAttempt", ledger "AiReservation", provider_request_id text, terminal boolean, attached boolean DEFAULT false)
 RETURNS void LANGUAGE plpgsql AS $$
DECLARE audit "AdminAudit"; b jsonb; execution jsonb;
BEGIN
 execution:=CASE WHEN terminal THEN v-'billingBasis' ELSE v END;
 IF (terminal AND NOT infame_planning_ai_terminal(v)) OR (NOT terminal AND NOT infame_planning_ai_execution(v))
  OR execution->>'reservationId' IS DISTINCT FROM attempt."reservationId"
  OR (execution->>'resolvedAt')::timestamp(3)<attempt."claimedAt" THEN
  RAISE EXCEPTION 'Invalid exact planning execution observation' USING ERRCODE='23514';
 END IF;
 IF execution->>'executionBasis'='REVIEWED_EXECUTION_RESOLUTION' THEN
  SELECT * INTO audit FROM "AdminAudit" WHERE id=execution->>'reference';
  IF audit.id IS NULL OR audit.action<>'AI_PLANNING_EXECUTION_REVIEWED' OR audit."resourceType"<>'PLANNING_ATTEMPT' OR audit."resourceId"<>attempt.id
   OR NOT infame_planning_ai_closed(audit.snapshot,ARRAY['evidenceHash','reservationId','providerRequestId','outcome'])
   OR audit.snapshot->'evidenceHash' IS DISTINCT FROM execution->'evidenceHash' OR audit.snapshot->>'reservationId' IS DISTINCT FROM attempt."reservationId"
   OR audit.snapshot->'providerRequestId' IS DISTINCT FROM COALESCE(to_jsonb(provider_request_id),'null'::jsonb)
   OR jsonb_typeof(audit.snapshot->'outcome') IS DISTINCT FROM 'string' OR (audit.snapshot->>'outcome' IN ('RESPONSE_KNOWN','NO_CALL')) IS NOT TRUE
   OR (attached AND audit.snapshot->>'outcome'<>'RESPONSE_KNOWN') OR audit."createdAt">(execution->>'resolvedAt')::timestamp(3) THEN
   RAISE EXCEPTION 'Execution review must resolve the exact immutable native audit' USING ERRCODE='23514';
  END IF;
 END IF;
 IF attached AND execution->>'executionBasis' NOT IN ('PROVIDER_TERMINAL_RESPONSE','REVIEWED_EXECUTION_RESOLUTION') THEN
  RAISE EXCEPTION 'Attached content requires known terminal response execution' USING ERRCODE='23514';
 END IF;
 IF terminal THEN
  b:=v->'billingBasis';
  IF ledger.id IS DISTINCT FROM attempt."reservationId" OR ledger.status IS DISTINCT FROM b->>'kind'
    OR (b->>'kind'='SETTLED' AND (b->>'settlementHash' IS DISTINCT FROM ledger.result->>'settlementHash' OR b->>'actualMicros' IS DISTINCT FROM ledger."actualMicros"::text))
    OR (b->>'kind'='RELEASED' AND (b->>'noCallReason' IS DISTINCT FROM ledger.result->>'noCallReason' OR ledger."actualMicros" IS DISTINCT FROM 0::bigint))
    OR (attached AND b->>'kind'<>'SETTLED')
    OR (execution->>'executionBasis'='REVIEWED_EXECUTION_RESOLUTION' AND audit.snapshot->>'outcome'='NO_CALL' AND b->>'kind'<>'RELEASED')
    OR (execution->>'executionBasis'='REVIEWED_EXECUTION_RESOLUTION' AND audit.snapshot->>'outcome'='RESPONSE_KNOWN' AND b->>'kind'<>'SETTLED') THEN
    RAISE EXCEPTION 'Planning terminal execution and actual billing must both resolve' USING ERRCODE='23514';
  END IF;
 END IF;
END $$;
CREATE FUNCTION infame_planning_ai_execution_audit_retention() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.action='AI_PLANNING_EXECUTION_REVIEWED' OR (TG_OP='UPDATE' AND NEW.action='AI_PLANNING_EXECUTION_REVIEWED') THEN
  RAISE EXCEPTION 'Planning execution review audit is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER "AdminAudit_planning_execution_retention" BEFORE UPDATE OR DELETE ON "AdminAudit" FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_execution_audit_retention();

-- All callers may read immutable IDs before locks, but never mutable epochs.
-- The future ledger owner additionally prelocks advisory/User/native AuthSession
-- parents before this order. There are intentionally no reservation->planning
-- callbacks, so ledger quarantine cannot deadlock or release a planning hold.
CREATE FUNCTION infame_planning_ai_lock_parents(session_id text, acting_seat_id text, nowait_lock boolean, lock_session boolean DEFAULT true, fingerprint jsonb DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql AS $$
DECLARE s "PlanningAiSession"; cycle "PlanningAiCycle"; enrollment_id text; suffix text; seat_count integer; expected_seats integer;
BEGIN
 SELECT * INTO s FROM "PlanningAiSession" WHERE id=session_id;
 IF s.id IS NULL THEN RAISE EXCEPTION 'Missing exact planning session' USING ERRCODE='23514'; END IF;
 SELECT "enrollmentId" INTO enrollment_id FROM "PlanningAiCycle" WHERE id=s."cycleId" AND "poolId"=s."poolId";
 suffix:=CASE WHEN nowait_lock THEN ' NOWAIT' ELSE '' END;
 -- Values use parameters, identifiers/lock suffixes are constants.
 EXECUTE 'SELECT id FROM "Brand" WHERE id=$1 FOR SHARE'||suffix USING s."brandId";
 IF s."organizationId" IS NOT NULL THEN
  EXECUTE 'SELECT id FROM "Organization" WHERE id=$1 FOR SHARE'||suffix USING s."organizationId";
  EXECUTE 'SELECT id FROM "OrganizationClient" WHERE id=$1 AND "organizationId"=$2 AND "brandId"=$3 FOR SHARE'||suffix USING s."clientId",s."organizationId",s."brandId";
  EXECUTE 'SELECT id FROM "OrganizationMembership" WHERE "organizationId"=$1 AND id IN (SELECT "membershipId" FROM "PlanningAiSeat" WHERE "poolId"=$2 AND id=ANY($3)) ORDER BY id COLLATE "C" FOR SHARE'||suffix
   USING s."organizationId",s."poolId",ARRAY[s."creationSeatId",COALESCE(acting_seat_id,s."creationSeatId")];
  EXECUTE 'SELECT id FROM "ClientGrant" WHERE "organizationId"=$1 AND "clientId"=$2 AND "membershipId" IN (SELECT "membershipId" FROM "PlanningAiSeat" WHERE "poolId"=$3 AND id=ANY($4)) ORDER BY id COLLATE "C" FOR SHARE'||suffix
   USING s."organizationId",s."clientId",s."poolId",ARRAY[s."creationSeatId",COALESCE(acting_seat_id,s."creationSeatId")];
 END IF;
 EXECUTE 'SELECT id FROM "PlanningWorkspace" WHERE id=$1 AND "brandId"=$2 FOR KEY SHARE'||suffix USING s."workspaceId",s."brandId";
 EXECUTE 'SELECT id FROM "Campaign" WHERE id=$1 AND "brandId"=$2 FOR SHARE'||suffix USING s."campaignId",s."brandId";
 EXECUTE 'SELECT "campaignId" FROM "CampaignPlanningBinding" WHERE "campaignId"=$1 AND "workspaceId"=$2 FOR KEY SHARE'||suffix USING s."campaignId",s."workspaceId";
 EXECUTE 'SELECT "campaignId" FROM "CampaignPlanningState" WHERE "campaignId"=$1 AND "workspaceId"=$2 FOR SHARE'||suffix USING s."campaignId",s."workspaceId";
 EXECUTE 'SELECT id FROM "CampaignAgent" WHERE id=$1 AND "campaignId"=$2 AND "workspaceId"=$3 FOR SHARE'||suffix USING s."agentId",s."campaignId",s."workspaceId";
 IF fingerprint IS NOT NULL THEN
  EXECUTE 'SELECT id FROM "CampaignContextSelection" WHERE id=$1 AND "campaignId"=$2 AND "workspaceId"=$3 FOR KEY SHARE'||suffix
   USING fingerprint#>>'{snapshot,selection,id}',s."campaignId",s."workspaceId";
  IF fingerprint->'context'<>'null'::jsonb THEN
   EXECUTE 'SELECT id FROM "BrandContextVersion" WHERE id=$1 AND "workspaceId"=$2 FOR KEY SHARE'||suffix USING fingerprint#>>'{context,versionId}',s."workspaceId";
   EXECUTE 'SELECT id FROM "BrandContextSubmission" WHERE id=$1 AND "workspaceId"=$2 FOR SHARE'||suffix USING fingerprint#>>'{context,submissionId}',s."workspaceId";
  END IF;
  EXECUTE 'SELECT id FROM "CampaignAgentTextSource" WHERE "agentId"=$1 AND id IN (SELECT value->>''id'' FROM jsonb_array_elements($2)) ORDER BY id COLLATE "C" FOR KEY SHARE'||suffix USING s."agentId",fingerprint->'sources';
  IF fingerprint->'confirmation'<>'null'::jsonb THEN
   EXECUTE 'SELECT id FROM "CampaignAgentConfirmationBatch" WHERE id=$1 AND "agentId"=$2 FOR KEY SHARE'||suffix USING fingerprint#>>'{confirmation,batchId}',s."agentId";
  END IF;
 END IF;
 EXECUTE 'SELECT id FROM "PlanningAiPool" WHERE id=$1 FOR SHARE'||suffix USING s."poolId";
 EXECUTE 'SELECT id FROM "PlanningAiEnrollment" WHERE id=$1 AND "poolId"=$2 FOR SHARE'||suffix USING enrollment_id,s."poolId";
 -- Creator and acting seats are one sorted lock set, even if they are identical.
 EXECUTE 'SELECT count(*) FROM (SELECT id FROM "PlanningAiSeat" WHERE "poolId"=$1 AND id=ANY($2) ORDER BY id COLLATE "C" FOR SHARE'||suffix||') q'
  INTO seat_count USING s."poolId",ARRAY[s."creationSeatId",COALESCE(acting_seat_id,s."creationSeatId")];
 expected_seats:=CASE WHEN acting_seat_id IS NULL OR acting_seat_id=s."creationSeatId" THEN 1 ELSE 2 END;
 EXECUTE 'SELECT * FROM "PlanningAiCycle" WHERE id=$1 AND "poolId"=$2 FOR UPDATE'||suffix INTO cycle USING s."cycleId",s."poolId";
 IF seat_count<>expected_seats OR cycle.id IS NULL OR cycle."enrollmentId" IS DISTINCT FROM enrollment_id THEN
  RAISE EXCEPTION 'Missing exact ordered planning principal' USING ERRCODE='23514';
 END IF;
 IF lock_session THEN EXECUTE 'SELECT id FROM "PlanningAiSession" WHERE id=$1 FOR UPDATE'||suffix USING s.id; END IF;
END $$;

CREATE FUNCTION infame_planning_ai_attempt_insert_native(a "PlanningAiAttempt", op "PlanningAiOperation", s "PlanningAiSession", ledger "AiReservation")
 RETURNS void LANGUAGE plpgsql AS $$
DECLARE fp jsonb:=a."scopeFingerprint"; expected_context jsonb; reserve_command jsonb; p "PlanningAiPool";
 e "PlanningAiEnrollment"; seat "PlanningAiSeat"; c "PlanningAiCycle"; agent "CampaignAgent"; brand "Brand";
 owner_version integer; context_version "BrandContextVersion"; sub "BrandContextSubmission"; source jsonb; pin jsonb; artifact jsonb;
 campaign "Campaign"; planning_state "CampaignPlanningState"; selection "CampaignContextSelection"; actor "User";
 batch "CampaignAgentConfirmationBatch"; confirmation jsonb; member "OrganizationMembership"; org "Organization"; client "OrganizationClient"; grant_row "ClientGrant";
BEGIN
 IF NOT infame_planning_ai_fingerprint(fp) OR NOT infame_planning_ai_pricing(a.pricing)
 OR NOT infame_planning_ai_request(a.request,fp,a."actorUserId",a."operationKey",a."scopeFingerprintHash")
 OR a."requestHash" IS DISTINCT FROM infame_planning_ai_hash(jsonb_build_object('domain','infame-planning-request-v1','actorUserId',a."actorUserId",'request',a.request))
 OR a."scopeFingerprintHash" IS DISTINCT FROM infame_planning_ai_hash(jsonb_build_object('domain','infame-planning-scope-v1')||fp)
 OR a."pricingHash" IS DISTINCT FROM infame_planning_ai_hash(a.pricing)
 OR ROW(a."operationId",a."sessionId",a."poolId") IS DISTINCT FROM ROW(op.id,op."sessionId",s."poolId")
 OR op.state<>'OPEN' OR s."allowanceState" NOT IN ('HELD','CONSUMED')
 OR fp->>'sessionId' IS DISTINCT FROM s.id OR fp#>>'{operation,id}' IS DISTINCT FROM op.id OR fp#>>'{operation,kind}' IS DISTINCT FROM op.kind
 OR (fp#>>'{operation,ordinal}')::integer IS DISTINCT FROM op.ordinal OR fp#>>'{pool,id}' IS DISTINCT FROM s."poolId"
 OR fp#>>'{seat,id}' IS DISTINCT FROM a."seatId" OR fp#>>'{actor,userId}' IS DISTINCT FROM a."actorUserId"
 OR fp#>>'{actor,role}' IS DISTINCT FROM a."actorRole" OR (fp#>>'{actor,sessionVersion}')::integer IS DISTINCT FROM a."actorSessionVersion"
 OR fp#>>'{binding,workspaceId}' IS DISTINCT FROM s."workspaceId" OR fp#>>'{binding,campaignId}' IS DISTINCT FROM s."campaignId"
 OR fp->>'brandId' IS DISTINCT FROM s."brandId" OR fp->>'organizationId' IS DISTINCT FROM s."organizationId" OR fp->>'clientId' IS DISTINCT FROM s."clientId"
 OR fp#>>'{binding,scope,kind}' IS DISTINCT FROM s.scope::text OR fp#>>'{agent,id}' IS DISTINCT FROM s."agentId" THEN
  RAISE EXCEPTION 'Planning request/fingerprint must bind exact native aggregate' USING ERRCODE='23514';
 END IF;
 SELECT * INTO p FROM "PlanningAiPool" WHERE id=s."poolId";
 SELECT * INTO c FROM "PlanningAiCycle" WHERE id=s."cycleId" AND "poolId"=s."poolId";
 SELECT * INTO e FROM "PlanningAiEnrollment" WHERE id=c."enrollmentId" AND "poolId"=s."poolId";
 SELECT * INTO seat FROM "PlanningAiSeat" WHERE id=a."seatId" AND "poolId"=s."poolId" AND "userId"=a."actorUserId";
 SELECT * INTO agent FROM "CampaignAgent" WHERE id=s."agentId" AND "campaignId"=s."campaignId" AND "workspaceId"=s."workspaceId";
 SELECT * INTO brand FROM "Brand" WHERE id=s."brandId";
 SELECT "sessionVersion" INTO owner_version FROM "User" WHERE id=brand."userId";
 SELECT * INTO actor FROM "User" WHERE id=a."actorUserId";
 SELECT * INTO campaign FROM "Campaign" WHERE id=s."campaignId" AND "brandId"=s."brandId";
 SELECT * INTO planning_state FROM "CampaignPlanningState" WHERE "campaignId"=s."campaignId" AND "workspaceId"=s."workspaceId";
 SELECT * INTO selection FROM "CampaignContextSelection" WHERE id=planning_state."selectionId" AND "campaignId"=s."campaignId" AND "workspaceId"=s."workspaceId" AND revision=planning_state."selectionRevision";
 IF p.id IS NULL OR c.id IS NULL OR e.id IS NULL OR seat.id IS NULL OR agent.id IS NULL OR brand.id IS NULL
 OR fp->'pool' IS DISTINCT FROM jsonb_build_object('id',p.id,'scope',p.scope,'brandId',p."brandId",'organizationId',p."organizationId")
 OR fp->'enrollment' IS DISTINCT FROM jsonb_build_object('id',e.id,'revision',e.revision,'subscriberUserId',e."subscriberUserId")
 OR fp->'seat' IS DISTINCT FROM jsonb_build_object('id',seat.id,'userId',seat."userId",'revision',seat.revision,'membershipId',seat."membershipId")
 OR fp#>>'{cycle,id}' IS DISTINCT FROM c.id OR (fp#>>'{cycle,startsAt}')::timestamp(3) IS DISTINCT FROM c."startsAt"
 OR (fp#>>'{cycle,endsAt}')::timestamp(3) IS DISTINCT FROM c."endsAt" OR fp#>>'{cycle,planId}' IS DISTINCT FROM c."planId"
 OR fp#>>'{cycle,policyVersion}' IS DISTINCT FROM c."policyVersion" OR fp#>>'{cycle,priceVersion}' IS DISTINCT FROM c."priceVersion"
 OR fp->'agent' IS DISTINCT FROM jsonb_build_object('id',agent.id,'revision',agent.revision,'stateHash',agent."stateHash")
 OR fp->'binding' IS DISTINCT FROM agent.state->'binding' OR fp->'snapshot' IS DISTINCT FROM agent.state->'snapshot'
 OR fp->'brandOwner' IS DISTINCT FROM jsonb_build_object('userId',brand."userId",'sessionVersion',owner_version)
 OR actor.id IS NULL OR actor.role::text IS DISTINCT FROM a."actorRole" OR actor."sessionVersion" IS DISTINCT FROM a."actorSessionVersion"
 OR campaign.id IS NULL OR planning_state."campaignId" IS NULL OR selection.id IS NULL
 OR fp#>'{snapshot,campaignRevision}' IS DISTINCT FROM to_jsonb(campaign.revision)
 OR fp#>'{snapshot,fieldsRevision}' IS DISTINCT FROM campaign.input->'fieldsRevision'
 OR fp#>'{snapshot,planningRevision}' IS DISTINCT FROM to_jsonb(planning_state.revision)
 OR fp#>>'{snapshot,fieldsHash}' IS DISTINCT FROM infame_planning_ai_hash(jsonb_build_object('domain','infame-campaign-fields-v1','fields',campaign.input->'fields'))
 OR agent.state->'fields' IS DISTINCT FROM campaign.input->'fields'
 OR fp#>'{snapshot,selection}' IS DISTINCT FROM jsonb_build_object('id',selection.id,'revision',selection.revision,
  'kind',CASE WHEN selection."contextVersionId" IS NULL THEN 'NONE' ELSE 'APPROVED_CONTEXT' END,'versionId',selection."contextVersionId",'contentHash',selection."contentHash") THEN
  RAISE EXCEPTION 'Planning fingerprint native principal/snapshot epoch mismatch' USING ERRCODE='23514';
 END IF;
 -- Actual eligibility, native AuthSession, expiry/consumed continuation and
 -- attachment admission remain separately reviewed runtime policy. No SQL label
 -- silently grants those decisions. This insert checks captured native structure.
 IF s.scope='CLIENT' THEN
  SELECT * INTO org FROM "Organization" WHERE id=s."organizationId";
  SELECT * INTO client FROM "OrganizationClient" WHERE id=s."clientId" AND "organizationId"=s."organizationId" AND "brandId"=s."brandId";
  SELECT * INTO member FROM "OrganizationMembership" WHERE id=seat."membershipId" AND "organizationId"=s."organizationId" AND "userId"=a."actorUserId";
  SELECT * INTO grant_row FROM "ClientGrant" WHERE id=fp#>>'{authority,plan,grantId}' AND "membershipId"=member.id AND "organizationId"=s."organizationId" AND "clientId"=s."clientId";
  IF org.id IS NULL OR client.id IS NULL OR member.id IS NULL OR grant_row.id IS NULL
   OR fp#>'{authority,plan}' IS DISTINCT FROM jsonb_build_object('organizationId',org.id,'clientId',client.id,'brandId',brand.id,'membershipId',member.id,'grantId',grant_row.id,'capability','plan',
    'organizationRevision',org.revision,'membershipRevision',member.revision,'clientRevision',client.revision,'grantRevision',grant_row.revision) THEN
   RAISE EXCEPTION 'Planning fingerprint native authority epoch mismatch' USING ERRCODE='23514';
  END IF;
 END IF;
 -- Approved immutable inputRevision, not mutable parent draft/counter revisions.
 IF fp->'context'<>'null'::jsonb THEN
  SELECT * INTO context_version FROM "BrandContextVersion" WHERE id=fp#>>'{context,versionId}' AND "workspaceId"=s."workspaceId";
  SELECT * INTO sub FROM "BrandContextSubmission" WHERE id=context_version."submissionId" AND "contextId"=context_version."contextId" AND "workspaceId"=s."workspaceId";
  IF context_version.id IS NULL OR sub.id IS NULL OR sub.state<>'APPROVED' OR sub."inputRevision" IS DISTINCT FROM context_version."inputRevision"
   OR fp->'context' IS DISTINCT FROM jsonb_build_object('contextId',context_version."contextId",'versionId',context_version.id,'version',context_version.version,
    'versionInputRevision',context_version."inputRevision",'contentHash',context_version."contentHash",'submissionId',context_version."submissionId") THEN
   RAISE EXCEPTION 'Planning context must bind approved immutable input epoch' USING ERRCODE='23514';
  END IF;
 END IF;
 FOR source IN SELECT * FROM jsonb_array_elements(fp->'sources') LOOP
  IF NOT EXISTS(SELECT 1 FROM "CampaignAgentTextSource" WHERE id=source->>'id' AND "sourceHash"=source->>'sourceHash' AND "agentId"=agent.id AND "campaignId"=s."campaignId" AND "workspaceId"=s."workspaceId") THEN
   RAISE EXCEPTION 'Planning source must resolve exact native source' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR artifact IN SELECT * FROM jsonb_array_elements(fp#>'{operation,selectedArtifacts}') LOOP
  IF NOT EXISTS(SELECT 1 FROM "PlanningAiResult" WHERE id=artifact->>'id' AND "sessionId"=s.id AND "poolId"=s."poolId" AND disposition='ATTACHED'
    AND "contentHash"=artifact->>'contentHash' AND content#>>'{output,kind}'=artifact->>'kind' AND content->'binding'=fp->'binding') THEN
   RAISE EXCEPTION 'Refinement base must resolve an exact immutable same-session artifact' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF fp->'confirmation'<>'null'::jsonb THEN
  SELECT * INTO batch FROM "CampaignAgentConfirmationBatch" WHERE id=fp#>>'{confirmation,batchId}' AND "agentId"=agent.id AND "campaignId"=s."campaignId" AND "workspaceId"=s."workspaceId";
  IF batch.id IS NULL OR batch."contentHash" IS DISTINCT FROM fp#>>'{confirmation,batchHash}' OR batch.content->'binding' IS DISTINCT FROM fp->'binding'
   OR batch.content->'reviewedSnapshot' IS DISTINCT FROM fp->'snapshot' THEN RAISE EXCEPTION 'Planning confirmation batch must resolve exact native snapshot' USING ERRCODE='23514'; END IF;
  FOR pin IN SELECT * FROM jsonb_array_elements(fp#>'{confirmation,fields}') LOOP
   SELECT value INTO confirmation FROM jsonb_array_elements(batch.content->'confirmations') WHERE value->>'id'=pin->>'id';
   IF confirmation IS NULL OR (confirmation->>'field') IS DISTINCT FROM (pin->>'field') OR confirmation->'valueHash' IS DISTINCT FROM pin->'valueHash'
    OR confirmation->'confirmationHash' IS DISTINCT FROM pin->'confirmationHash'
    OR pin->>'valueHash' IS DISTINCT FROM infame_planning_ai_hash(jsonb_build_object('domain','infame-campaign-field-value-v1','field',pin->'field','value',agent.state#>ARRAY['fields',pin->>'field'])) THEN
    RAISE EXCEPTION 'Planning confirmation pin must resolve current native field' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 expected_context:=jsonb_build_object('resourceType','JOB','resourceId',a.id,'sourceRevision',fp#>'{agent,revision}');
 reserve_command:=jsonb_build_object('operationKey',a."ledgerOperationKey",'purpose',a."ledgerPurpose",'payloadHash',a."payloadHash",'reservedMicros',a."reservedMicros"::text,
   'pricing',a.pricing,'context',expected_context,'executionTimeoutMs',a."executionTimeoutMs");
 IF ledger.id IS NULL OR ledger.status<>'RUNNING' OR ledger."userId" IS DISTINCT FROM a."actorUserId" OR ledger."operationKey" IS DISTINCT FROM a."ledgerOperationKey"
 OR ledger."payloadHash" IS DISTINCT FROM a."payloadHash" OR ledger.purpose IS DISTINCT FROM a."ledgerPurpose" OR ledger."reservedMicros" IS DISTINCT FROM a."reservedMicros"
 OR a."ledgerPurpose" IS DISTINCT FROM (CASE op.kind WHEN 'REPLY' THEN 'CAMPAIGN_CHAT' WHEN 'BRIEF' THEN 'BRIEF' ELSE 'CONTENT_THEME' END)
 OR NOT infame_planning_ai_closed(ledger.result,ARRAY['schemaVersion','actorRole','actorSessionVersion','requestHash','pricing','context','executionTimeoutMs','executionTokenHash','claimedAt','deadlineAt',
  'quarantineReason','settlementHash','usage','settlementPricing','estimatedActualMicros','noCallReason','overrun','overrunResolved','reconciliation'])
 OR octet_length(ledger.result::text)>8192 OR ledger.result->'schemaVersion' IS DISTINCT FROM '1'::jsonb
 OR ledger.result->>'actorRole' IS DISTINCT FROM a."actorRole" OR ledger.result->'actorSessionVersion' IS DISTINCT FROM to_jsonb(a."actorSessionVersion")
 OR ledger.result->'pricing' IS DISTINCT FROM a.pricing OR ledger.result->'context' IS DISTINCT FROM expected_context
 OR ledger.result->'executionTimeoutMs' IS DISTINCT FROM to_jsonb(a."executionTimeoutMs") OR ledger.result->>'executionTokenHash' IS DISTINCT FROM a."executionTokenHash"
 OR ledger.result->>'requestHash' IS DISTINCT FROM a."ledgerRequestHash" OR a."ledgerRequestHash" IS DISTINCT FROM infame_planning_ai_hash(reserve_command)
 OR jsonb_typeof(ledger.result->'claimedAt') IS DISTINCT FROM 'string' OR jsonb_typeof(ledger.result->'deadlineAt') IS DISTINCT FROM 'string'
 OR length(ledger.result->>'claimedAt')>40 OR length(ledger.result->>'deadlineAt')>40
 OR (ledger.result->>'claimedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$'
 OR (ledger.result->>'deadlineAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$'
 OR ((ledger.result->>'claimedAt')::timestamptz AT TIME ZONE 'UTC')::timestamp(3) IS DISTINCT FROM a."claimedAt"
 OR ((ledger.result->>'deadlineAt')::timestamptz AT TIME ZONE 'UTC')::timestamp(3) IS DISTINCT FROM a."deadlineAt"
 OR ledger.result->'quarantineReason' IS DISTINCT FROM 'null'::jsonb OR ledger.result->'settlementHash' IS DISTINCT FROM 'null'::jsonb OR ledger.result->'usage' IS DISTINCT FROM 'null'::jsonb
 OR ledger.result->'settlementPricing' IS DISTINCT FROM 'null'::jsonb OR ledger.result->'estimatedActualMicros' IS DISTINCT FROM 'null'::jsonb OR ledger.result->'noCallReason' IS DISTINCT FROM 'null'::jsonb
 OR ledger.result->'overrun' IS DISTINCT FROM 'false'::jsonb OR ledger.result->'overrunResolved' IS DISTINCT FROM 'false'::jsonb OR ledger.result->'reconciliation' IS DISTINCT FROM 'null'::jsonb THEN
  RAISE EXCEPTION 'Planning attempt must bind the exact original running ledger claim' USING ERRCODE='23514';
 END IF;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Invalid native planning ledger/fingerprint value' USING ERRCODE='23514'; END $$;

CREATE FUNCTION infame_planning_ai_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE op "PlanningAiOperation"; s "PlanningAiSession"; ledger "AiReservation"; result_row "PlanningAiResult";
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Planning attempt history is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'RUNNING' OR NEW.revision<>1 OR NEW."executionEvidenceJson" IS NOT NULL OR NEW."knownFailureEvidenceJson" IS NOT NULL OR NEW."providerRequestId" IS NOT NULL THEN
   RAISE EXCEPTION 'Invalid initial planning attempt' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','revision','updatedAt','executionEvidenceJson','knownFailureEvidenceJson','providerRequestId']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','revision','updatedAt','executionEvidenceJson','knownFailureEvidenceJson','providerRequestId'])
   OR NEW.revision::bigint<>OLD.revision::bigint+1 OR NEW."updatedAt"<OLD."updatedAt"
   OR (OLD.state IN ('FAILED_KNOWN','RESULT_RECORDED') AND to_jsonb(NEW)-ARRAY['revision','updatedAt'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['revision','updatedAt'])
   OR (OLD."executionEvidenceJson" IS NOT NULL AND NEW."executionEvidenceJson" IS DISTINCT FROM OLD."executionEvidenceJson")
   OR (OLD."providerRequestId" IS NOT NULL AND NEW."providerRequestId" IS DISTINCT FROM OLD."providerRequestId")
   OR NOT (NEW.state=OLD.state OR (OLD.state='RUNNING' AND NEW.state IN ('UNKNOWN','FAILED_KNOWN','RESULT_RECORDED')) OR (OLD.state='UNKNOWN' AND NEW.state IN ('FAILED_KNOWN','RESULT_RECORDED'))) THEN
   RAISE EXCEPTION 'Planning attempt identity/evidence/transition is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 PERFORM infame_planning_ai_lock_parents(NEW."sessionId",NEW."seatId",TG_OP='UPDATE',true,NEW."scopeFingerprint");
 IF TG_OP='INSERT' THEN
  SELECT * INTO op FROM "PlanningAiOperation" WHERE id=NEW."operationId" AND "sessionId"=NEW."sessionId" FOR UPDATE;
  SELECT * INTO ledger FROM "AiReservation" WHERE id=NEW."reservationId" FOR SHARE;
 ELSE
  SELECT * INTO op FROM "PlanningAiOperation" WHERE id=NEW."operationId" AND "sessionId"=NEW."sessionId" FOR UPDATE NOWAIT;
  SELECT * INTO ledger FROM "AiReservation" WHERE id=NEW."reservationId" FOR SHARE NOWAIT;
 END IF;
 SELECT * INTO s FROM "PlanningAiSession" WHERE id=NEW."sessionId" AND "poolId"=NEW."poolId";
 IF op.id IS NULL OR s.id IS NULL OR ledger.id IS NULL THEN RAISE EXCEPTION 'Missing exact planning attempt parent' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN PERFORM infame_planning_ai_attempt_insert_native(NEW,op,s,ledger); END IF;
 IF NEW."executionEvidenceJson" IS NOT NULL THEN PERFORM infame_planning_ai_evidence_native(NEW."executionEvidenceJson",NEW,ledger,NEW."providerRequestId",false); END IF;
 IF NEW.state='FAILED_KNOWN' THEN
  IF NEW."knownFailureEvidenceJson"-'billingBasis' IS DISTINCT FROM NEW."executionEvidenceJson"
   OR EXISTS(SELECT 1 FROM "PlanningAiResult" WHERE "attemptId"=NEW.id) THEN RAISE EXCEPTION 'Known failure requires exact terminal evidence and no final Result' USING ERRCODE='23514'; END IF;
  PERFORM infame_planning_ai_evidence_native(NEW."knownFailureEvidenceJson",NEW,ledger,NEW."providerRequestId",true);
 ELSIF NEW.state='RESULT_RECORDED' THEN
  SELECT * INTO result_row FROM "PlanningAiResult" WHERE "attemptId"=NEW.id AND "operationId"=NEW."operationId" AND "sessionId"=NEW."sessionId" AND "poolId"=NEW."poolId";
  IF result_row.id IS NULL OR result_row."terminalEvidenceJson"-'billingBasis' IS DISTINCT FROM NEW."executionEvidenceJson"
   OR result_row."providerRequestId" IS DISTINCT FROM NEW."providerRequestId" THEN RAISE EXCEPTION 'Recorded planning attempt requires its exact immutable Result' USING ERRCODE='23514'; END IF;
  PERFORM infame_planning_ai_evidence_native(result_row."terminalEvidenceJson",NEW,ledger,NEW."providerRequestId",true,result_row.disposition='ATTACHED');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PlanningAiAttempt_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PlanningAiAttempt" FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_attempt_guard();

ALTER TABLE "PlanningAiSession" DROP CONSTRAINT "PlanningAiSession_shape";
ALTER TABLE "PlanningAiSession" ADD CONSTRAINT "PlanningAiSession_shape" CHECK ((infame_planning_ai_id(id)
 AND infame_planning_ai_id("poolId") AND infame_planning_ai_id("cycleId") AND infame_planning_ai_id("brandId")
 AND ("organizationId" IS NULL OR infame_planning_ai_id("organizationId")) AND ("clientId" IS NULL OR infame_planning_ai_id("clientId"))
 AND infame_planning_ai_id("workspaceId") AND infame_planning_ai_id("campaignId") AND infame_planning_ai_id("agentId")
 AND infame_planning_ai_id("createdByUserId") AND infame_planning_ai_id("creationSeatId")
 AND ((scope='OWN_BRAND' AND "organizationId" IS NULL AND "clientId" IS NULL) OR (scope='CLIENT' AND "organizationId" IS NOT NULL AND "clientId" IS NOT NULL))
 AND revision BETWEEN 1 AND 2147483646 AND isfinite("createdAt") AND isfinite("updatedAt") AND "updatedAt">="createdAt"
 AND (("allowanceState" IN ('HELD','RELEASED') AND "firstAttachedResultId" IS NULL)
   OR ("allowanceState"='CONSUMED' AND infame_planning_ai_id("firstAttachedResultId")))) IS TRUE);
ALTER TABLE "PlanningAiOperation" DROP CONSTRAINT "PlanningAiOperation_shape";
ALTER TABLE "PlanningAiOperation" ADD CONSTRAINT "PlanningAiOperation_shape" CHECK ((infame_planning_ai_id(id) AND infame_planning_ai_id("sessionId")
 AND ((kind='REPLY' AND ordinal BETWEEN 1 AND 10) OR (kind IN ('BRIEF','STRATEGY','IDEAS_PACK','COMBINED_REFINEMENT') AND ordinal=1))
 AND revision BETWEEN 1 AND 2147483646 AND isfinite("createdAt") AND isfinite("updatedAt") AND "updatedAt">="createdAt"
 AND ((state='OPEN' AND "successfulResultId" IS NULL) OR (state='SUCCEEDED' AND infame_planning_ai_id("successfulResultId")))) IS TRUE);

CREATE OR REPLACE FUNCTION infame_planning_ai_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "PlanningAiPool"; c "PlanningAiCycle"; e "PlanningAiEnrollment"; seat "PlanningAiSeat";
 w "PlanningWorkspace"; enrollment_id text; admit boolean; current_utc timestamp(3); r "PlanningAiResult"; prior "PlanningAiAttempt"; l "AiReservation";
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Planning session history is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW."allowanceState"<>'HELD' OR NEW.revision<>1 OR NEW."firstAttachedResultId" IS NOT NULL THEN RAISE EXCEPTION 'Invalid initial planning session' USING ERRCODE='23514'; END IF;
  -- Preserve migration33's post-wait eligibility check and domain-first order.
  PERFORM id FROM "PlanningWorkspace" WHERE id=NEW."workspaceId" AND "brandId"=NEW."brandId" FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing exact planning workspace' USING ERRCODE='23514'; END IF;
  PERFORM "campaignId" FROM "CampaignPlanningBinding" WHERE "campaignId"=NEW."campaignId" AND "workspaceId"=NEW."workspaceId" FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing exact planning campaign binding' USING ERRCODE='23514'; END IF;
  PERFORM id FROM "CampaignAgent" WHERE id=NEW."agentId" AND "campaignId"=NEW."campaignId" AND "workspaceId"=NEW."workspaceId" FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing exact planning agent' USING ERRCODE='23514'; END IF;
  SELECT "enrollmentId" INTO enrollment_id FROM "PlanningAiCycle" WHERE id=NEW."cycleId" AND "poolId"=NEW."poolId";
  SELECT * INTO p FROM "PlanningAiPool" WHERE id=NEW."poolId" FOR SHARE;
  SELECT * INTO e FROM "PlanningAiEnrollment" WHERE id=enrollment_id AND "poolId"=NEW."poolId" FOR SHARE;
  SELECT * INTO seat FROM "PlanningAiSeat" WHERE id=NEW."creationSeatId" AND "poolId"=NEW."poolId" AND "userId"=NEW."createdByUserId" FOR SHARE;
  SELECT * INTO c FROM "PlanningAiCycle" WHERE id=NEW."cycleId" AND "poolId"=NEW."poolId" FOR UPDATE;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['allowanceState','firstAttachedResultId','revision','updatedAt']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['allowanceState','firstAttachedResultId','revision','updatedAt'])
   OR NEW.revision::bigint<>OLD.revision::bigint+1 OR NEW."updatedAt"<OLD."updatedAt"
   OR (OLD."allowanceState"='CONSUMED' AND ROW(NEW."allowanceState",NEW."firstAttachedResultId") IS DISTINCT FROM ROW(OLD."allowanceState",OLD."firstAttachedResultId"))
   OR NOT (NEW."allowanceState"=OLD."allowanceState" OR (OLD."allowanceState"='HELD' AND NEW."allowanceState" IN ('CONSUMED','RELEASED'))
     OR (OLD."allowanceState"='RELEASED' AND NEW."allowanceState"='HELD'))
   OR (OLD."firstAttachedResultId" IS NOT NULL AND NEW."firstAttachedResultId" IS DISTINCT FROM OLD."firstAttachedResultId") THEN
   RAISE EXCEPTION 'Planning session identity/first consumption/revision is immutable' USING ERRCODE='23514'; END IF;
  PERFORM id FROM "PlanningWorkspace" WHERE id=NEW."workspaceId" AND "brandId"=NEW."brandId" FOR KEY SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing exact planning workspace' USING ERRCODE='23514'; END IF;
  PERFORM "campaignId" FROM "CampaignPlanningBinding" WHERE "campaignId"=NEW."campaignId" AND "workspaceId"=NEW."workspaceId" FOR KEY SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing exact planning campaign binding' USING ERRCODE='23514'; END IF;
  PERFORM id FROM "CampaignAgent" WHERE id=NEW."agentId" AND "campaignId"=NEW."campaignId" AND "workspaceId"=NEW."workspaceId" FOR KEY SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing exact planning agent' USING ERRCODE='23514'; END IF;
  PERFORM infame_planning_ai_lock_parents(NEW.id,NULL,true,false);
  SELECT * INTO p FROM "PlanningAiPool" WHERE id=NEW."poolId";
  SELECT * INTO c FROM "PlanningAiCycle" WHERE id=NEW."cycleId" AND "poolId"=NEW."poolId";
  SELECT * INTO e FROM "PlanningAiEnrollment" WHERE id=c."enrollmentId" AND "poolId"=NEW."poolId";
  SELECT * INTO seat FROM "PlanningAiSeat" WHERE id=NEW."creationSeatId" AND "poolId"=NEW."poolId" AND "userId"=NEW."createdByUserId";
 END IF;
 SELECT * INTO w FROM "PlanningWorkspace" WHERE id=NEW."workspaceId" AND "brandId"=NEW."brandId";
 IF p.id IS NULL OR c.id IS NULL OR e.id IS NULL OR seat.id IS NULL OR w.id IS NULL
 OR ROW(w.scope,w."brandId",w."organizationId",w."clientId") IS DISTINCT FROM ROW(NEW.scope,NEW."brandId",NEW."organizationId",NEW."clientId")
 OR p.scope IS DISTINCT FROM NEW.scope::text OR (NEW.scope='OWN_BRAND' AND p."brandId" IS DISTINCT FROM NEW."brandId")
 OR (NEW.scope='CLIENT' AND p."organizationId" IS DISTINCT FROM NEW."organizationId") THEN RAISE EXCEPTION 'Missing exact planning session scope/principal' USING ERRCODE='23514'; END IF;
 admit:=TG_OP='INSERT';
 IF TG_OP='UPDATE' THEN admit:=OLD."allowanceState"='RELEASED' AND NEW."allowanceState"='HELD'; END IF;
 IF admit THEN
  current_utc:=(clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  IF p.state<>'ACTIVE' OR e.state<>'ACTIVE' OR seat.state<>'ACTIVE' OR c.state<>'ACTIVE' OR current_utc<c."startsAt" OR current_utc>=c."endsAt" THEN
   RAISE EXCEPTION 'Planning hold requires current eligible exact parents' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW."allowanceState"='CONSUMED' THEN
  SELECT * INTO r FROM "PlanningAiResult" WHERE id=NEW."firstAttachedResultId" AND "sessionId"=NEW.id AND "poolId"=NEW."poolId" AND disposition='ATTACHED';
  IF r.id IS NULL THEN RAISE EXCEPTION 'Consumption requires a same-session attached first Result' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD."allowanceState"='HELD' AND NEW."allowanceState"='RELEASED' THEN
  IF EXISTS(SELECT 1 FROM "PlanningAiAttempt" WHERE "sessionId"=NEW.id AND state IN ('RUNNING','UNKNOWN'))
   OR EXISTS(SELECT 1 FROM "PlanningAiResult" WHERE "sessionId"=NEW.id AND disposition='ATTACHED') THEN
   RAISE EXCEPTION 'Unresolved sibling or attached success preserves the shared hold' USING ERRCODE='23514'; END IF;
  -- A terminal-looking label alone cannot justify entitlement release.
  FOR prior IN SELECT * FROM "PlanningAiAttempt" WHERE "sessionId"=NEW.id ORDER BY id COLLATE "C" LOOP
   SELECT * INTO l FROM "AiReservation" WHERE id=prior."reservationId";
   IF prior.state='FAILED_KNOWN' THEN
    PERFORM infame_planning_ai_evidence_native(prior."knownFailureEvidenceJson",prior,l,prior."providerRequestId",true);
   ELSIF prior.state='RESULT_RECORDED' THEN
    SELECT * INTO r FROM "PlanningAiResult" WHERE "attemptId"=prior.id;
    IF r.id IS NULL OR r.disposition='ATTACHED' OR r."terminalEvidenceJson"-'billingBasis' IS DISTINCT FROM prior."executionEvidenceJson" THEN
     RAISE EXCEPTION 'Release requires exact known sibling failure results' USING ERRCODE='23514'; END IF;
    PERFORM infame_planning_ai_evidence_native(r."terminalEvidenceJson",prior,l,prior."providerRequestId",true);
   ELSE RAISE EXCEPTION 'Release requires known terminal execution and billing' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION infame_planning_ai_session_counters() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_held bigint; actual_consumed bigint; admit boolean; current_utc timestamp(3); c "PlanningAiCycle";
BEGIN
 admit:=TG_OP='INSERT'; IF TG_OP='UPDATE' THEN admit:=OLD."allowanceState"='RELEASED' AND NEW."allowanceState"='HELD'; END IF;
 IF admit THEN
  SELECT * INTO c FROM "PlanningAiCycle" WHERE id=NEW."cycleId";
  current_utc:=(clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  IF current_utc<c."startsAt" OR current_utc>=c."endsAt" THEN RAISE EXCEPTION 'Planning admission expired during insertion waits' USING ERRCODE='23514'; END IF;
 END IF;
 -- All statement-visible rows count once. Update BOTH counters in one revision.
 SELECT count(*) FILTER (WHERE "allowanceState"='HELD'),count(*) FILTER (WHERE "allowanceState"='CONSUMED')
  INTO actual_held,actual_consumed FROM "PlanningAiSession" WHERE "cycleId"=NEW."cycleId";
 UPDATE "PlanningAiCycle" SET held=actual_held::integer,consumed=actual_consumed::integer,revision=revision+1,
   "updatedAt"=GREATEST("updatedAt",(clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3))
  WHERE id=NEW."cycleId" AND "poolId"=NEW."poolId" AND ROW(held::bigint,consumed::bigint) IS DISTINCT FROM ROW(actual_held,actual_consumed);
 RETURN NEW;
END $$;
-- Existing deferred Session_90_counts and Cycle_session_counts remain active;
-- their existing function already checks both HELD and CONSUMED exact counts.
CREATE OR REPLACE FUNCTION infame_planning_ai_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "PlanningAiSession"; r "PlanningAiResult";
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Planning inclusion history is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'OPEN' OR NEW.revision<>1 OR NEW."successfulResultId" IS NOT NULL THEN RAISE EXCEPTION 'Invalid initial planning inclusion' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','successfulResultId','revision','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','successfulResultId','revision','updatedAt'])
   OR NEW.revision::bigint<>OLD.revision::bigint+1 OR NEW."updatedAt"<OLD."updatedAt"
   OR (OLD.state='SUCCEEDED' AND ROW(NEW.state,NEW."successfulResultId") IS DISTINCT FROM ROW(OLD.state,OLD."successfulResultId"))
   OR NOT (NEW.state=OLD.state OR (OLD.state='OPEN' AND NEW.state='SUCCEEDED')) THEN RAISE EXCEPTION 'Planning inclusion identity/success/revision is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 PERFORM infame_planning_ai_lock_parents(NEW."sessionId",NULL,TG_OP='UPDATE');
 SELECT * INTO s FROM "PlanningAiSession" WHERE id=NEW."sessionId";
 IF s.id IS NULL OR (TG_OP='INSERT' AND s."allowanceState" NOT IN ('HELD','CONSUMED')) THEN
  RAISE EXCEPTION 'Planning inclusion requires a held or consumed exact session' USING ERRCODE='23514'; END IF;
 IF NEW.state='SUCCEEDED' THEN
  SELECT * INTO r FROM "PlanningAiResult" WHERE id=NEW."successfulResultId" AND "operationId"=NEW.id AND "sessionId"=NEW."sessionId" AND disposition='ATTACHED';
  IF r.id IS NULL THEN RAISE EXCEPTION 'Planning success requires its exact attached Result' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION infame_planning_ai_result_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "PlanningAiAttempt"; op "PlanningAiOperation"; s "PlanningAiSession"; ledger "AiReservation"; wire jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Planning Result is immutable retained history' USING ERRCODE='23514'; END IF;
 -- Only immutable lookup fields precede the ordered ancestor locks.
 SELECT * INTO a FROM "PlanningAiAttempt" WHERE id=NEW."attemptId";
 IF a.id IS NULL OR ROW(NEW."operationId",NEW."sessionId",NEW."poolId") IS DISTINCT FROM ROW(a."operationId",a."sessionId",a."poolId") THEN
  RAISE EXCEPTION 'Planning Result requires exact Attempt aggregate' USING ERRCODE='23514'; END IF;
 PERFORM infame_planning_ai_lock_parents(a."sessionId",a."seatId",false,true,a."scopeFingerprint");
 SELECT * INTO op FROM "PlanningAiOperation" WHERE id=a."operationId" AND "sessionId"=a."sessionId" FOR UPDATE;
 SELECT * INTO a FROM "PlanningAiAttempt" WHERE id=NEW."attemptId" FOR UPDATE;
 SELECT * INTO ledger FROM "AiReservation" WHERE id=a."reservationId" FOR SHARE;
 SELECT * INTO s FROM "PlanningAiSession" WHERE id=a."sessionId" AND "poolId"=a."poolId";
 IF a.state NOT IN ('RUNNING','UNKNOWN') OR NEW."createdAt"<a."createdAt"
  OR (a."providerRequestId" IS NOT NULL AND NEW."providerRequestId" IS DISTINCT FROM a."providerRequestId")
  OR (a."executionEvidenceJson" IS NOT NULL AND NEW."terminalEvidenceJson"-'billingBasis' IS DISTINCT FROM a."executionEvidenceJson") THEN
  RAISE EXCEPTION 'Planning Result must finish the original unresolved Attempt observation' USING ERRCODE='23514'; END IF;
 PERFORM infame_planning_ai_evidence_native(NEW."terminalEvidenceJson",a,ledger,NEW."providerRequestId",true,NEW.disposition='ATTACHED');
 IF NEW.disposition='ATTACHED' THEN
  wire:=infame_planning_ai_retained_wire(NEW.content,a."scopeFingerprint");
  IF wire IS NULL OR op.state<>'OPEN' OR s."allowanceState" NOT IN ('HELD','CONSUMED')
   OR NEW.content->>'attemptId' IS DISTINCT FROM a.id OR NEW.content#>>'{provider,modelId}' IS DISTINCT FROM a.pricing->>'modelId'
   OR NEW.content#>>'{provider,registryVersion}' IS DISTINCT FROM a."registryVersion"
   OR NEW.content#>'{provider,requestId}' IS DISTINCT FROM COALESCE(to_jsonb(NEW."providerRequestId"),'null'::jsonb)
   OR NEW."contentHash" IS DISTINCT FROM infame_planning_ai_hash(NEW.content) OR NEW."wireHash" IS DISTINCT FROM infame_planning_ai_hash(wire) THEN
   RAISE EXCEPTION 'Attached planning Result requires exact validated content and normalized wire pins' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PlanningAiResult_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PlanningAiResult" FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_result_guard();
CREATE FUNCTION infame_planning_ai_result_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE first_id text;
BEGIN
 -- This Result's BEFORE guard holds domain->principals->session->op->attempt->
 -- reservation locks. Child UPDATE guards reacquire ancestors NOWAIT only.
 UPDATE "PlanningAiAttempt" SET state='RESULT_RECORDED',"executionEvidenceJson"=NEW."terminalEvidenceJson"-'billingBasis',
  "providerRequestId"=NEW."providerRequestId",revision=revision+1,
  "updatedAt"=GREATEST("updatedAt",NEW."createdAt",(clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)) WHERE id=NEW."attemptId";
 IF NEW.disposition='ATTACHED' THEN
  UPDATE "PlanningAiOperation" SET state='SUCCEEDED',"successfulResultId"=NEW.id,revision=revision+1,
   "updatedAt"=GREATEST("updatedAt",NEW."createdAt",(clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)) WHERE id=NEW."operationId" AND state='OPEN';
  -- Choose the same deterministic first pointer from all rows already visible in
  -- this statement. Its queued AFTER event may still be pending; local guards
  -- verify that pointer only, deferred guards verify all completed children.
  SELECT id INTO first_id FROM "PlanningAiResult" WHERE "sessionId"=NEW."sessionId" AND "poolId"=NEW."poolId" AND disposition='ATTACHED'
    ORDER BY "createdAt",id COLLATE "C" LIMIT 1;
  UPDATE "PlanningAiSession" SET "allowanceState"='CONSUMED',"firstAttachedResultId"=first_id,revision=revision+1,
   "updatedAt"=GREATEST("updatedAt",NEW."createdAt",(clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)) WHERE id=NEW."sessionId" AND "allowanceState"='HELD';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PlanningAiResult_00_complete" AFTER INSERT ON "PlanningAiResult" FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_result_complete();

CREATE FUNCTION infame_planning_ai_assert_result(result_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r "PlanningAiResult"; a "PlanningAiAttempt"; op "PlanningAiOperation"; s "PlanningAiSession"; ledger "AiReservation";
BEGIN
 SELECT * INTO r FROM "PlanningAiResult" WHERE id=result_id;
 SELECT * INTO a FROM "PlanningAiAttempt" WHERE id=r."attemptId" AND "operationId"=r."operationId" AND "sessionId"=r."sessionId" AND "poolId"=r."poolId";
 SELECT * INTO op FROM "PlanningAiOperation" WHERE id=r."operationId" AND "sessionId"=r."sessionId";
 SELECT * INTO s FROM "PlanningAiSession" WHERE id=r."sessionId" AND "poolId"=r."poolId";
 SELECT * INTO ledger FROM "AiReservation" WHERE id=a."reservationId";
 IF r.id IS NULL OR a.id IS NULL OR op.id IS NULL OR s.id IS NULL OR a.state<>'RESULT_RECORDED'
  OR a."executionEvidenceJson" IS DISTINCT FROM r."terminalEvidenceJson"-'billingBasis'
  OR a."providerRequestId" IS DISTINCT FROM r."providerRequestId" THEN RAISE EXCEPTION 'Final Result requires exact terminal Attempt join' USING ERRCODE='23514'; END IF;
 PERFORM infame_planning_ai_evidence_native(r."terminalEvidenceJson",a,ledger,a."providerRequestId",true,r.disposition='ATTACHED');
 IF r.disposition='ATTACHED' THEN
  IF op.state<>'SUCCEEDED' OR op."successfulResultId" IS DISTINCT FROM r.id OR s."allowanceState"<>'CONSUMED'
   OR NOT EXISTS(SELECT 1 FROM "PlanningAiResult" WHERE id=s."firstAttachedResultId" AND "sessionId"=s.id AND "poolId"=s."poolId" AND disposition='ATTACHED') THEN
   RAISE EXCEPTION 'Attached Result must complete its inclusion and actual session consumption' USING ERRCODE='23514'; END IF;
 END IF;
 -- Do not inspect unrelated queued sibling AFTER completions in immediate mode.
END $$;
CREATE FUNCTION infame_planning_ai_result_local_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM infame_planning_ai_assert_result(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER "PlanningAiResult_10_local_consistency" AFTER INSERT ON "PlanningAiResult" FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_result_local_check();

-- Constraint triggers may be SET IMMEDIATE. Each parent verifies only its own
-- invariant at its mutation boundary: Attempt, then Operation, then Session.
-- Result_10/Result_95 verify the completed Result and all three exact parents.
CREATE FUNCTION infame_planning_ai_assert_session_local(session_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s "PlanningAiSession"; has_attached boolean;
BEGIN
 SELECT * INTO s FROM "PlanningAiSession" WHERE id=session_id;
 IF s.id IS NULL THEN RAISE EXCEPTION 'Missing retained session aggregate' USING ERRCODE='23514'; END IF;
 has_attached:=EXISTS(SELECT 1 FROM "PlanningAiResult" WHERE "sessionId"=s.id AND "poolId"=s."poolId" AND disposition='ATTACHED');
 IF (s."allowanceState"='CONSUMED') IS DISTINCT FROM has_attached
  OR (s."allowanceState"='CONSUMED' AND NOT EXISTS(SELECT 1 FROM "PlanningAiResult" WHERE id=s."firstAttachedResultId" AND "sessionId"=s.id AND "poolId"=s."poolId" AND disposition='ATTACHED')) THEN
   RAISE EXCEPTION 'Session consumption must equal actual attached retained history' USING ERRCODE='23514'; END IF;
 IF s."allowanceState"='RELEASED' AND EXISTS(SELECT 1 FROM "PlanningAiAttempt" WHERE "sessionId"=s.id AND state IN ('RUNNING','UNKNOWN')) THEN
  RAISE EXCEPTION 'Released session cannot contain an unresolved sibling Attempt' USING ERRCODE='23514'; END IF;
 -- Deliberately do not inspect pointer Attempt/Operation: a deterministic bulk
 -- first pointer may identify an ATTACHED Result whose AFTER event is queued.
 PERFORM infame_planning_ai_assert_cycle_counts(s."cycleId");
END $$;
CREATE FUNCTION infame_planning_ai_assert_operation_local(operation_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE op "PlanningAiOperation"; r "PlanningAiResult"; a "PlanningAiAttempt";
BEGIN
 SELECT * INTO op FROM "PlanningAiOperation" WHERE id=operation_id;
 IF op.id IS NULL THEN RAISE EXCEPTION 'Missing retained inclusion' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM "PlanningAiResult" WHERE "operationId"=op.id AND "sessionId"=op."sessionId" AND disposition='ATTACHED';
 IF (op.state='SUCCEEDED') IS DISTINCT FROM (r.id IS NOT NULL) OR (op.state='SUCCEEDED' AND op."successfulResultId" IS DISTINCT FROM r.id) THEN
  RAISE EXCEPTION 'Inclusion success must equal its actual exact attached Result' USING ERRCODE='23514'; END IF;
 IF r.id IS NOT NULL THEN
  SELECT * INTO a FROM "PlanningAiAttempt" WHERE id=r."attemptId" AND "operationId"=op.id AND "sessionId"=op."sessionId" AND "poolId"=r."poolId";
  IF a.id IS NULL OR a.state<>'RESULT_RECORDED' OR a."executionEvidenceJson" IS DISTINCT FROM r."terminalEvidenceJson"-'billingBasis'
   OR a."providerRequestId" IS DISTINCT FROM r."providerRequestId" THEN RAISE EXCEPTION 'Succeeded inclusion requires its exact terminal Attempt' USING ERRCODE='23514'; END IF;
 END IF;
 -- Session consumption is the next auto-completion step, checked by this Result.
END $$;
CREATE FUNCTION infame_planning_ai_assert_attempt_local(attempt_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a "PlanningAiAttempt"; r "PlanningAiResult"; ledger "AiReservation";
BEGIN
 SELECT * INTO a FROM "PlanningAiAttempt" WHERE id=attempt_id;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Missing retained Attempt' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM "PlanningAiResult" WHERE "attemptId"=a.id;
 IF (a.state='RESULT_RECORDED') IS DISTINCT FROM (r.id IS NOT NULL) THEN RAISE EXCEPTION 'Attempt terminal state must equal its own immutable Result' USING ERRCODE='23514'; END IF;
 SELECT * INTO ledger FROM "AiReservation" WHERE id=a."reservationId";
 IF a.state='RESULT_RECORDED' THEN
  IF ROW(r."operationId",r."sessionId",r."poolId") IS DISTINCT FROM ROW(a."operationId",a."sessionId",a."poolId")
   OR a."executionEvidenceJson" IS DISTINCT FROM r."terminalEvidenceJson"-'billingBasis' OR a."providerRequestId" IS DISTINCT FROM r."providerRequestId" THEN
   RAISE EXCEPTION 'Recorded Attempt must preserve its exact Result observation' USING ERRCODE='23514'; END IF;
  PERFORM infame_planning_ai_evidence_native(r."terminalEvidenceJson",a,ledger,a."providerRequestId",true,r.disposition='ATTACHED');
 ELSIF a.state='FAILED_KNOWN' THEN
  IF a."knownFailureEvidenceJson"-'billingBasis' IS DISTINCT FROM a."executionEvidenceJson" THEN RAISE EXCEPTION 'Known failure observation must remain exact' USING ERRCODE='23514'; END IF;
  PERFORM infame_planning_ai_evidence_native(a."knownFailureEvidenceJson",a,ledger,a."providerRequestId",true);
 ELSIF EXISTS(SELECT 1 FROM "PlanningAiSession" WHERE id=a."sessionId" AND "allowanceState"='RELEASED') THEN
  RAISE EXCEPTION 'Unresolved Attempt preserves its shared session hold' USING ERRCODE='23514';
 END IF;
 -- Operation and Session remain unfinished during Result_00's Attempt update.
END $$;
CREATE FUNCTION infame_planning_ai_aggregate_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 CASE TG_TABLE_NAME
 WHEN 'PlanningAiSession' THEN PERFORM infame_planning_ai_assert_session_local(NEW.id);
 WHEN 'PlanningAiOperation' THEN PERFORM infame_planning_ai_assert_operation_local(NEW.id);
 WHEN 'PlanningAiAttempt' THEN PERFORM infame_planning_ai_assert_attempt_local(NEW.id);
 WHEN 'PlanningAiResult' THEN PERFORM infame_planning_ai_assert_result(NEW.id);
 ELSE RAISE EXCEPTION 'Unknown retained planning constraint target' USING ERRCODE='23514';
 END CASE;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "PlanningAiSession_95_results" AFTER INSERT OR UPDATE ON "PlanningAiSession"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_aggregate_check();
CREATE CONSTRAINT TRIGGER "PlanningAiOperation_95_results" AFTER INSERT OR UPDATE ON "PlanningAiOperation"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_aggregate_check();
CREATE CONSTRAINT TRIGGER "PlanningAiAttempt_95_results" AFTER INSERT OR UPDATE ON "PlanningAiAttempt"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_aggregate_check();
CREATE CONSTRAINT TRIGGER "PlanningAiResult_95_results" AFTER INSERT ON "PlanningAiResult"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION infame_planning_ai_aggregate_check();
-- Every retained parent/child mutation schedules its local invariant, and each
-- Result schedules its completed join. SET CONSTRAINTS ALL IMMEDIATE is supported
-- without sibling scans, authority bypass flags or temporary suppression.
-- No authority bypass flag, trigger suppression, reset or ledger callback exists.
COMMIT;
