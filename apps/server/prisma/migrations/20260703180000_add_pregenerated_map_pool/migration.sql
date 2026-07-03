CREATE TABLE "PregeneratedMapArtifact" (
  "id" TEXT NOT NULL,
  "storageProvider" TEXT NOT NULL DEFAULT 'database',
  "storageKey" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "compressionCodec" TEXT NOT NULL DEFAULT 'none',
  "contentHash" TEXT NOT NULL,
  "manifestSchemaVersion" INTEGER NOT NULL,
  "data" BYTEA,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PregeneratedMapArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PregeneratedMap" (
  "id" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "generatorVersion" INTEGER NOT NULL,
  "seed" BIGINT NOT NULL,
  "themeId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "gameplayMode" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "mapSize" TEXT NOT NULL,
  "topologyId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "previewTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "previewSilhouette" JSONB NOT NULL,
  "stats" JSONB NOT NULL,
  "diagnosticsScore" DOUBLE PRECISION NOT NULL,
  "diagnosticsWarnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'ready',
  "visibility" TEXT NOT NULL DEFAULT 'public',
  "lastSelectedAt" TIMESTAMP(3),
  "selectionCount" INTEGER NOT NULL DEFAULT 0,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "reservationExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PregeneratedMap_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PregeneratedMapSelection" (
  "id" TEXT NOT NULL,
  "mapId" TEXT NOT NULL,
  "lobbyId" TEXT,
  "roomId" TEXT,
  "matchId" TEXT,
  "selectionSource" TEXT NOT NULL,
  "selectedByPlayerId" TEXT,
  "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PregeneratedMapSelection_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GameMatch"
  ADD COLUMN "mapSize" TEXT,
  ADD COLUMN "mapProfileId" TEXT,
  ADD COLUMN "mapTopologyId" TEXT,
  ADD COLUMN "mapGeneratorVersion" INTEGER,
  ADD COLUMN "pregeneratedMapId" TEXT;

CREATE UNIQUE INDEX "PregeneratedMapArtifact_storageKey_key" ON "PregeneratedMapArtifact"("storageKey");
CREATE UNIQUE INDEX "PregeneratedMapArtifact_contentHash_key" ON "PregeneratedMapArtifact"("contentHash");
CREATE INDEX "PregeneratedMapArtifact_storageProvider_idx" ON "PregeneratedMapArtifact"("storageProvider");
CREATE INDEX "PregeneratedMapArtifact_contentHash_idx" ON "PregeneratedMapArtifact"("contentHash");
CREATE INDEX "PregeneratedMapArtifact_createdAt_idx" ON "PregeneratedMapArtifact"("createdAt");

CREATE UNIQUE INDEX "PregeneratedMap_seed_themeId_profileId_mapSize_topologyId_generatorVersion_visibility_key"
  ON "PregeneratedMap"("seed", "themeId", "profileId", "mapSize", "topologyId", "generatorVersion", "visibility");
CREATE INDEX "PregeneratedMap_artifactId_idx" ON "PregeneratedMap"("artifactId");
CREATE INDEX "PregeneratedMap_status_visibility_gameplayMode_profileId_mapSize_themeId_topologyId_idx"
  ON "PregeneratedMap"("status", "visibility", "gameplayMode", "profileId", "mapSize", "themeId", "topologyId");
CREATE INDEX "PregeneratedMap_gameplayMode_profileId_mapSize_status_visibility_lastSelectedAt_idx"
  ON "PregeneratedMap"("gameplayMode", "profileId", "mapSize", "status", "visibility", "lastSelectedAt");
CREATE INDEX "PregeneratedMap_generatorVersion_status_idx" ON "PregeneratedMap"("generatorVersion", "status");
CREATE INDEX "PregeneratedMap_lastSelectedAt_idx" ON "PregeneratedMap"("lastSelectedAt");
CREATE INDEX "PregeneratedMap_createdAt_idx" ON "PregeneratedMap"("createdAt");

CREATE INDEX "PregeneratedMapSelection_mapId_selectedAt_idx" ON "PregeneratedMapSelection"("mapId", "selectedAt");
CREATE INDEX "PregeneratedMapSelection_lobbyId_idx" ON "PregeneratedMapSelection"("lobbyId");
CREATE INDEX "PregeneratedMapSelection_roomId_idx" ON "PregeneratedMapSelection"("roomId");
CREATE INDEX "PregeneratedMapSelection_matchId_idx" ON "PregeneratedMapSelection"("matchId");
CREATE INDEX "PregeneratedMapSelection_selectionSource_selectedAt_idx" ON "PregeneratedMapSelection"("selectionSource", "selectedAt");

CREATE INDEX "GameMatch_mapSize_idx" ON "GameMatch"("mapSize");
CREATE INDEX "GameMatch_mapProfileId_idx" ON "GameMatch"("mapProfileId");
CREATE INDEX "GameMatch_mapTopologyId_idx" ON "GameMatch"("mapTopologyId");
CREATE INDEX "GameMatch_pregeneratedMapId_idx" ON "GameMatch"("pregeneratedMapId");

ALTER TABLE "PregeneratedMap"
  ADD CONSTRAINT "PregeneratedMap_artifactId_fkey"
  FOREIGN KEY ("artifactId") REFERENCES "PregeneratedMapArtifact"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PregeneratedMapSelection"
  ADD CONSTRAINT "PregeneratedMapSelection_mapId_fkey"
  FOREIGN KEY ("mapId") REFERENCES "PregeneratedMap"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GameMatch"
  ADD CONSTRAINT "GameMatch_pregeneratedMapId_fkey"
  FOREIGN KEY ("pregeneratedMapId") REFERENCES "PregeneratedMap"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
