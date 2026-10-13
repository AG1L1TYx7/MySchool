-- CreateTable
CREATE TABLE `SubscriptionPlans` (
    `Id` CHAR(36) NOT NULL,
    `Code` VARCHAR(32) NOT NULL,
    `Name` VARCHAR(80) NOT NULL,
    `Description` VARCHAR(500) NULL,
    `PricePerStudentCents` INTEGER NOT NULL DEFAULT 0,
    `MinimumCents` INTEGER NOT NULL DEFAULT 0,
    `IncludedStudents` INTEGER NOT NULL DEFAULT 0,
    `Features` TEXT NULL,
    `IsActive` BOOLEAN NOT NULL DEFAULT true,
    `SortOrder` INTEGER NOT NULL DEFAULT 0,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `SubscriptionPlans_Code_key`(`Code`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Subscriptions` (
    `Id` CHAR(36) NOT NULL,
    `TenantId` CHAR(36) NOT NULL,
    `PlanId` CHAR(36) NOT NULL,
    `Status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `Seats` INTEGER NOT NULL DEFAULT 0,
    `BillingEmail` VARCHAR(120) NULL,
    `BillingName` VARCHAR(200) NULL,
    `CurrentPeriodStart` DATETIME(6) NOT NULL,
    `CurrentPeriodEnd` DATETIME(6) NOT NULL,
    `TrialEndsAt` DATETIME(6) NULL,
    `Provider` VARCHAR(16) NOT NULL DEFAULT 'manual',
    `ProviderRef` VARCHAR(120) NULL,
    `CanceledAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `Subscriptions_TenantId_key`(`TenantId`),
    INDEX `Subscriptions_Status_idx`(`Status`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invoices` (
    `Id` CHAR(36) NOT NULL,
    `TenantId` CHAR(36) NOT NULL,
    `SubscriptionId` CHAR(36) NULL,
    `Number` VARCHAR(24) NOT NULL,
    `Status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `PeriodStart` DATETIME(6) NOT NULL,
    `PeriodEnd` DATETIME(6) NOT NULL,
    `Lines` TEXT NOT NULL,
    `SubtotalCents` INTEGER NOT NULL,
    `TaxCents` INTEGER NOT NULL DEFAULT 0,
    `TotalCents` INTEGER NOT NULL,
    `Currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `IssuedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `DueAt` DATETIME(6) NOT NULL,
    `PaidAt` DATETIME(6) NULL,
    `VoidedAt` DATETIME(6) NULL,
    `Provider` VARCHAR(16) NOT NULL DEFAULT 'manual',
    `ProviderRef` VARCHAR(120) NULL,
    `Note` VARCHAR(500) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `Invoices_Number_key`(`Number`),
    INDEX `Invoices_TenantId_Status_IssuedAt_idx`(`TenantId`, `Status`, `IssuedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IdempotencyKeys` (
    `Id` CHAR(36) NOT NULL,
    `ActorId` CHAR(36) NOT NULL,
    `Route` VARCHAR(120) NOT NULL,
    `Key` VARCHAR(120) NOT NULL,
    `RequestHash` CHAR(64) NOT NULL,
    `StatusCode` INTEGER NOT NULL,
    `ResponseBody` TEXT NOT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `ExpiresAt` DATETIME(6) NOT NULL,

    INDEX `IdempotencyKeys_ExpiresAt_idx`(`ExpiresAt`),
    UNIQUE INDEX `IdempotencyKeys_ActorId_Route_Key_key`(`ActorId`, `Route`, `Key`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UsageDaily` (
    `Id` CHAR(36) NOT NULL,
    `TenantId` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `Day` DATE NOT NULL,
    `ApiRequests` INTEGER NOT NULL DEFAULT 0,
    `AiCalls` INTEGER NOT NULL DEFAULT 0,
    `ActiveUsers` INTEGER NOT NULL DEFAULT 0,
    `ActiveStudents` INTEGER NOT NULL DEFAULT 0,
    `StorageMb` INTEGER NOT NULL DEFAULT 0,
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `UsageDaily_TenantId_Day_idx`(`TenantId`, `Day`),
    UNIQUE INDEX `UsageDaily_TenantId_OrganizationId_Day_key`(`TenantId`, `OrganizationId`, `Day`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UsageActivity` (
    `Id` CHAR(36) NOT NULL,
    `TenantId` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `Day` DATE NOT NULL,
    `UserId` CHAR(36) NOT NULL,

    INDEX `UsageActivity_TenantId_Day_idx`(`TenantId`, `Day`),
    UNIQUE INDEX `UsageActivity_OrganizationId_Day_UserId_key`(`OrganizationId`, `Day`, `UserId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ServiceIncidents` (
    `Id` CHAR(36) NOT NULL,
    `Kind` VARCHAR(16) NOT NULL DEFAULT 'incident',
    `Title` VARCHAR(200) NOT NULL,
    `Status` VARCHAR(16) NOT NULL DEFAULT 'investigating',
    `Impact` VARCHAR(16) NOT NULL DEFAULT 'minor',
    `Components` VARCHAR(200) NOT NULL,
    `IsPublic` BOOLEAN NOT NULL DEFAULT true,
    `StartedAt` DATETIME(6) NOT NULL,
    `ResolvedAt` DATETIME(6) NULL,
    `ScheduledFor` DATETIME(6) NULL,
    `ScheduledUntil` DATETIME(6) NULL,
    `Updates` TEXT NOT NULL,
    `CreatedById` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `ServiceIncidents_Status_StartedAt_idx`(`Status`, `StartedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StatusChecks` (
    `Id` CHAR(36) NOT NULL,
    `CheckedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `Status` VARCHAR(16) NOT NULL,
    `Components` VARCHAR(500) NOT NULL,
    `LatencyMs` INTEGER NOT NULL DEFAULT 0,

    INDEX `StatusChecks_CheckedAt_idx`(`CheckedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Subscriptions` ADD CONSTRAINT `Subscriptions_TenantId_fkey` FOREIGN KEY (`TenantId`) REFERENCES `Tenants`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscriptions` ADD CONSTRAINT `Subscriptions_PlanId_fkey` FOREIGN KEY (`PlanId`) REFERENCES `SubscriptionPlans`(`Id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoices` ADD CONSTRAINT `Invoices_TenantId_fkey` FOREIGN KEY (`TenantId`) REFERENCES `Tenants`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoices` ADD CONSTRAINT `Invoices_SubscriptionId_fkey` FOREIGN KEY (`SubscriptionId`) REFERENCES `Subscriptions`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UsageDaily` ADD CONSTRAINT `UsageDaily_TenantId_fkey` FOREIGN KEY (`TenantId`) REFERENCES `Tenants`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UsageDaily` ADD CONSTRAINT `UsageDaily_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

