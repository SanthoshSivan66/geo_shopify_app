-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "geoScore" INTEGER NOT NULL DEFAULT 0,
    "schemaQuality" INTEGER NOT NULL DEFAULT 0,
    "aiBotAccess" INTEGER NOT NULL DEFAULT 0,
    "contentStructure" INTEGER NOT NULL DEFAULT 0,
    "conversationalReady" INTEGER NOT NULL DEFAULT 0,
    "technicalSpeed" INTEGER NOT NULL DEFAULT 0,
    "metaSocial" INTEGER NOT NULL DEFAULT 0,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "schemasEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastScan" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanHistory" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "geoScore" INTEGER NOT NULL,
    "schemaQuality" INTEGER NOT NULL DEFAULT 0,
    "aiBotAccess" INTEGER NOT NULL DEFAULT 0,
    "contentStructure" INTEGER NOT NULL DEFAULT 0,
    "conversationalReady" INTEGER NOT NULL DEFAULT 0,
    "technicalSpeed" INTEGER NOT NULL DEFAULT 0,
    "metaSocial" INTEGER NOT NULL DEFAULT 0,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorScan" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "competitorUrl" TEXT NOT NULL,
    "competitorName" TEXT NOT NULL DEFAULT '',
    "geoScore" INTEGER NOT NULL DEFAULT 0,
    "schemaQuality" INTEGER NOT NULL DEFAULT 0,
    "aiBotAccess" INTEGER NOT NULL DEFAULT 0,
    "contentStructure" INTEGER NOT NULL DEFAULT 0,
    "hasProductSchema" BOOLEAN NOT NULL DEFAULT false,
    "hasOrgSchema" BOOLEAN NOT NULL DEFAULT false,
    "hasBreadcrumb" BOOLEAN NOT NULL DEFAULT false,
    "hasFaqSchema" BOOLEAN NOT NULL DEFAULT false,
    "hasLlmsTxt" BOOLEAN NOT NULL DEFAULT false,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_shop_key" ON "Store"("shop");

-- AddForeignKey
ALTER TABLE "ScanHistory" ADD CONSTRAINT "ScanHistory_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Store"("shop") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorScan" ADD CONSTRAINT "CompetitorScan_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Store"("shop") ON DELETE RESTRICT ON UPDATE CASCADE;
