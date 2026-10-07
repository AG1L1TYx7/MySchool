-- CreateTable
CREATE TABLE `WebhookSubscriptions` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `Name` VARCHAR(100) NOT NULL,
    `Url` VARCHAR(500) NOT NULL,
    `Secret` VARCHAR(128) NOT NULL,
    `Events` TEXT NULL,
    `IsActive` BOOLEAN NOT NULL DEFAULT true,
    `RetryLimit` INTEGER NOT NULL DEFAULT 5,
    `FailureCount` INTEGER NOT NULL DEFAULT 0,
    `LastDeliveredAt` DATETIME(6) NULL,
    `CreatedById` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `WebhookSubscriptions_OrganizationId_IsActive_idx`(`OrganizationId`, `IsActive`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebhookDeliveries` (
    `Id` CHAR(36) NOT NULL,
    `SubscriptionId` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `EventId` CHAR(36) NOT NULL,
    `EventType` VARCHAR(100) NOT NULL,
    `Payload` TEXT NOT NULL,
    `Status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `Attempts` INTEGER NOT NULL DEFAULT 0,
    `ResponseCode` INTEGER NULL,
    `LastError` VARCHAR(500) NULL,
    `NextAttemptAt` DATETIME(6) NOT NULL,
    `DeliveredAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `WebhookDeliveries_Status_NextAttemptAt_idx`(`Status`, `NextAttemptAt`),
    INDEX `WebhookDeliveries_SubscriptionId_CreatedAt_idx`(`SubscriptionId`, `CreatedAt`),
    INDEX `WebhookDeliveries_OrganizationId_CreatedAt_idx`(`OrganizationId`, `CreatedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiKeys` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `Name` VARCHAR(100) NOT NULL,
    `Prefix` VARCHAR(16) NOT NULL,
    `KeyHash` VARCHAR(128) NOT NULL,
    `Scopes` TEXT NOT NULL,
    `RateLimitPerMinute` INTEGER NOT NULL DEFAULT 600,
    `CreatedById` CHAR(36) NOT NULL,
    `LastUsedAt` DATETIME(6) NULL,
    `ExpiresAt` DATETIME(6) NULL,
    `RevokedAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `ApiKeys_Prefix_key`(`Prefix`),
    INDEX `ApiKeys_OrganizationId_RevokedAt_idx`(`OrganizationId`, `RevokedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LtiPlatforms` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `Name` VARCHAR(100) NOT NULL,
    `Issuer` VARCHAR(500) NOT NULL,
    `ClientId` VARCHAR(200) NOT NULL,
    `DeploymentId` VARCHAR(200) NULL,
    `AuthorizationUrl` VARCHAR(500) NOT NULL,
    `JwksUrl` VARCHAR(500) NOT NULL,
    `TokenUrl` VARCHAR(500) NULL,
    `IsActive` BOOLEAN NOT NULL DEFAULT true,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `LtiPlatforms_OrganizationId_idx`(`OrganizationId`),
    UNIQUE INDEX `LtiPlatforms_Issuer_ClientId_key`(`Issuer`, `ClientId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LtiUserLinks` (
    `Id` CHAR(36) NOT NULL,
    `PlatformId` CHAR(36) NOT NULL,
    `Subject` VARCHAR(255) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `LtiUserLinks_UserId_idx`(`UserId`),
    UNIQUE INDEX `LtiUserLinks_PlatformId_Subject_key`(`PlatformId`, `Subject`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LtiTools` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `Name` VARCHAR(100) NOT NULL,
    `ClientId` VARCHAR(64) NOT NULL,
    `DeploymentId` VARCHAR(64) NOT NULL,
    `LoginUrl` VARCHAR(500) NOT NULL,
    `LaunchUrl` VARCHAR(500) NOT NULL,
    `JwksUrl` VARCHAR(500) NULL,
    `CustomParams` TEXT NULL,
    `IsActive` BOOLEAN NOT NULL DEFAULT true,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `LtiTools_ClientId_key`(`ClientId`),
    INDEX `LtiTools_OrganizationId_IsActive_idx`(`OrganizationId`, `IsActive`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LtiKeys` (
    `Id` CHAR(36) NOT NULL,
    `Kid` VARCHAR(64) NOT NULL,
    `PrivatePem` TEXT NOT NULL,
    `PublicJwk` TEXT NOT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `LtiKeys_Kid_key`(`Kid`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WebhookSubscriptions` ADD CONSTRAINT `WebhookSubscriptions_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebhookDeliveries` ADD CONSTRAINT `WebhookDeliveries_SubscriptionId_fkey` FOREIGN KEY (`SubscriptionId`) REFERENCES `WebhookSubscriptions`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiKeys` ADD CONSTRAINT `ApiKeys_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiKeys` ADD CONSTRAINT `ApiKeys_CreatedById_fkey` FOREIGN KEY (`CreatedById`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LtiPlatforms` ADD CONSTRAINT `LtiPlatforms_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LtiUserLinks` ADD CONSTRAINT `LtiUserLinks_PlatformId_fkey` FOREIGN KEY (`PlatformId`) REFERENCES `LtiPlatforms`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LtiUserLinks` ADD CONSTRAINT `LtiUserLinks_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LtiTools` ADD CONSTRAINT `LtiTools_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

