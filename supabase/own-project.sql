-- Ordo with your own database: run after schema.sql in the SQL editor of your own Supabase project.
-- (The app's setup "Eigene Datenbank verbinden" copies schema.sql and this file together.)
--
-- Sets the project up for one person or one firm on the Supabase free plan:
--   * up to 50 accounts, about 900 MB per person (the free plan has 1 GB of file storage for the whole project),
--   * every member sees the project's usage against the Supabase limits.
-- Running it again changes nothing: the defaults are only written the first time.

do $$
begin
  if not exists (select 1 from public.summa_settings where key = 'own_project') then
    insert into public.summa_settings (key, value, description)
    values ('own_project', 'true', 'Eigenes Projekt: alle Mitglieder sehen den Verbrauch.');
    update public.summa_settings set value = '50' where key = 'max_accounts';
    update public.summa_settings set value = '900' where key = 'max_vault_mb';
    update public.summa_settings set value = jsonb_set(value, '{free,storage_mb}', '900') where key = 'plans';
  end if;
end $$;

select 'Ordo ist eingerichtet – Schema-Version ' || public.summa_schema_version() as ergebnis;
