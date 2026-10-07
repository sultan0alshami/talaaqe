-- Native fixture exposed PL/pgSQL variable/column ambiguity. Keep applied migration 17 intact.
CREATE OR REPLACE FUNCTION infame_reference_manifest_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item JSONB; part JSONB; ids TEXT[]:=ARRAY[]::TEXT[]; binding TEXT;
BEGIN
 -- Key-share every referenced binding in sorted order before validation. This
 -- serializes JSON insertion with DELETE and its deferred retention check.
 PERFORM id FROM "ContextAssetBinding"
  WHERE id IN (SELECT entries.item->>'bindingId' FROM jsonb_array_elements(NEW.items) AS entries(item)) ORDER BY id FOR KEY SHARE;
 IF NEW.hash<>encode(sha256(convert_to(infame_reference_canonical(NEW.items),'UTF8')),'hex') THEN
  RAISE EXCEPTION 'Reference manifest hash mismatch' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
  IF jsonb_typeof(item)<>'object' OR NOT(item ?& ARRAY['bindingId','labelOriginal','notesOriginal'])
   OR (SELECT count(*) FROM jsonb_object_keys(item))<>3 OR jsonb_typeof(item->'bindingId')<>'string' THEN
   RAISE EXCEPTION 'Reference item shape invalid' USING ERRCODE='23514'; END IF;
  binding:=item->>'bindingId';
  IF binding=ANY(ids) OR NOT EXISTS(SELECT 1 FROM "ContextAssetBinding" WHERE id=binding AND "contextId"=NEW."contextId" AND "workspaceId"=NEW."workspaceId") THEN
   RAISE EXCEPTION 'Reference item binding invalid' USING ERRCODE='23514'; END IF;
  ids:=array_append(ids,binding);
  FOREACH part IN ARRAY ARRAY[item->'labelOriginal',item->'notesOriginal'] LOOP
   IF jsonb_typeof(part)<>'object' OR NOT(part ?& ARRAY['text','language']) OR (SELECT count(*) FROM jsonb_object_keys(part))<>2
    OR jsonb_typeof(part->'text') NOT IN ('string','null') OR jsonb_typeof(part->'language') NOT IN ('string','null') THEN
    RAISE EXCEPTION 'Reference original metadata invalid' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF jsonb_typeof(item->'labelOriginal'->'text')<>'string' OR length(item->'labelOriginal'->>'text')>200
   OR length(btrim(item->'labelOriginal'->>'text'))=0 OR length(item->'notesOriginal'->>'text')>2000 THEN
   RAISE EXCEPTION 'Reference original metadata bounds invalid' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
