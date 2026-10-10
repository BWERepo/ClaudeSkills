# BWESEO schema migrations

`index.mjs` lists the migrations between schema versions of stored customer data. Schema 1 is current, so
the list is empty. See the header of `index.mjs` for the contract (backup → migrate → validate → roll back
on failure; never fabricate values).
