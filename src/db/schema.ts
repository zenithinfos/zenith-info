import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Sauvegardes de partie. Le client envoie un état JSON opaque (position,
 * inventaire, expéditions terminées) rattaché à un identifiant d'appareil.
 */
export const saves = pgTable(
  "saves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: text("player_id").notNull(),
    deviceId: text("device_id").notNull(),
    slot: integer("slot").notNull().default(0),
    label: text("label").notNull().default("Expédition"),
    gameVersion: text("game_version").notNull(),
    playtimeSeconds: integer("playtime_seconds").notNull().default(0),
    state: jsonb("state").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("saves_device_slot_idx").on(table.deviceId, table.slot),
    index("saves_player_idx").on(table.playerId),
  ],
);

/**
 * Paiements (PayPal, Mobile Money). `reference` est l'identifiant public
 * renvoyé au client ; `providerRef` l'identifiant côté prestataire.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(),
    provider: text("provider").notNull(), // paypal | airtel | moov | simulation
    planId: text("plan_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("EUR"),
    status: text("status").notNull().default("pending"), // pending | paid | failed | refunded
    email: text("email"),
    phone: text("phone"),
    providerRef: text("provider_ref"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("payments_status_idx").on(table.status),
    index("payments_provider_ref_idx").on(table.providerRef),
  ],
);

/** Journal des téléchargements : sert aux statistiques de /admin. */
export const downloadEvents = pgTable(
  "download_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: text("package_id").notNull(),
    platform: text("platform"),
    version: text("version").notNull(),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** true si le fichier binaire a réellement été envoyé. */
    served: boolean("served").notNull().default(false),
  },
  (table) => [index("download_events_package_idx").on(table.packageId)],
);
