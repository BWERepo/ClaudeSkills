// Schema migrations for customer data (engine 1.7.0 ships none: schema 1 is current).
//
// A migration moves STORED CUSTOMER DATA from one schema version to the next. It is only ever run by
// `/BWESEOInstall --update`, after the installer has backed up seo/*.json, and it must:
//   • preserve every existing value (never regenerate, never fabricate a missing value);
//   • be validated (`validate` returns true) — otherwise the installer restores the backup;
//   • be deterministic and idempotent.
//
//   export const migrations = [
//     { from: 1, to: 2, description: "…", migrate: async (projectDir) => { … }, validate: async (projectDir) => true },
//   ];
export const migrations = [];
