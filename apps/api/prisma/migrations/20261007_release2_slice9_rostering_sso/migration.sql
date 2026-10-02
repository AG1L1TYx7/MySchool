-- AlterTable
ALTER TABLE `Organizations` ADD COLUMN `ExternalId` VARCHAR(128) NULL,
    ADD COLUMN `SsoAllowedDomains` VARCHAR(500) NULL,
    ADD COLUMN `SsoPasswordOptional` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `SsoProviders` VARCHAR(200) NULL;

-- AlterTable
ALTER TABLE `Users` ADD COLUMN `ExternalId` VARCHAR(128) NULL,
    ADD COLUMN `ManagedBySis` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `Source` ENUM('MANUAL', 'ONEROSTER', 'CLEVER', 'CLASSLINK') NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE `Students` ADD COLUMN `ExternalId` VARCHAR(128) NULL,
    ADD COLUMN `ManagedBySis` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `Source` ENUM('MANUAL', 'ONEROSTER', 'CLEVER', 'CLASSLINK') NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE `StudentGuardians` ADD COLUMN `Source` ENUM('MANUAL', 'ONEROSTER', 'CLEVER', 'CLASSLINK') NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE `Courses` ADD COLUMN `ExternalId` VARCHAR(128) NULL,
    ADD COLUMN `Source` ENUM('MANUAL', 'ONEROSTER', 'CLEVER', 'CLASSLINK') NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE `Classes` ADD COLUMN `ExternalId` VARCHAR(128) NULL,
    ADD COLUMN `ManagedBySis` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `PeriodLabel` VARCHAR(50) NULL,
    ADD COLUMN `Source` ENUM('MANUAL', 'ONEROSTER', 'CLEVER', 'CLASSLINK') NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE `ClassEnrollments` ADD COLUMN `ExternalId` VARCHAR(128) NULL,
    ADD COLUMN `ManagedBySis` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `Source` ENUM('MANUAL', 'ONEROSTER', 'CLEVER', 'CLASSLINK') NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE `UserIdentities` (
    `Id` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `Provider` ENUM('GOOGLE', 'MICROSOFT', 'CLEVER', 'CLASSLINK') NOT NULL,
    `Subject` VARCHAR(255) NOT NULL,
    `Email` VARCHAR(256) NULL,
    `LinkedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `UserIdentities_UserId_idx`(`UserId`),
    UNIQUE INDEX `UserIdentities_Provider_Subject_key`(`Provider`, `Subject`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RosterSources` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `Provider` ENUM('ONEROSTER_CSV', 'ONEROSTER_API', 'CLEVER', 'CLASSLINK') NOT NULL,
    `Name` VARCHAR(120) NOT NULL,
    `Config` TEXT NOT NULL,
    `IsEnabled` BOOLEAN NOT NULL DEFAULT true,
    `LastRunAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `RosterSources_OrganizationId_idx`(`OrganizationId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RosterSyncRuns` (
    `Id` CHAR(36) NOT NULL,
    `SourceId` CHAR(36) NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `Provider` ENUM('ONEROSTER_CSV', 'ONEROSTER_API', 'CLEVER', 'CLASSLINK') NOT NULL,
    `Status` ENUM('QUEUED', 'RUNNING', 'DONE', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `DryRun` BOOLEAN NOT NULL DEFAULT false,
    `TriggeredById` CHAR(36) NULL,
    `StartedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `FinishedAt` DATETIME(6) NULL,
    `Summary` TEXT NULL,
    `ErrorMessage` TEXT NULL,

    INDEX `RosterSyncRuns_OrganizationId_StartedAt_idx`(`OrganizationId`, `StartedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RosterSyncErrors` (
    `Id` CHAR(36) NOT NULL,
    `RunId` CHAR(36) NOT NULL,
    `EntityType` VARCHAR(40) NOT NULL,
    `ExternalId` VARCHAR(128) NULL,
    `Message` VARCHAR(500) NOT NULL,

    INDEX `RosterSyncErrors_RunId_idx`(`RunId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Users_OrganizationId_ExternalId_idx` ON `Users`(`OrganizationId`, `ExternalId`);

-- CreateIndex
CREATE INDEX `Students_OrganizationId_ExternalId_idx` ON `Students`(`OrganizationId`, `ExternalId`);

-- CreateIndex
CREATE INDEX `Classes_OrganizationId_ExternalId_idx` ON `Classes`(`OrganizationId`, `ExternalId`);

-- AddForeignKey
ALTER TABLE `UserIdentities` ADD CONSTRAINT `UserIdentities_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RosterSources` ADD CONSTRAINT `RosterSources_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RosterSyncRuns` ADD CONSTRAINT `RosterSyncRuns_SourceId_fkey` FOREIGN KEY (`SourceId`) REFERENCES `RosterSources`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RosterSyncRuns` ADD CONSTRAINT `RosterSyncRuns_TriggeredById_fkey` FOREIGN KEY (`TriggeredById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RosterSyncErrors` ADD CONSTRAINT `RosterSyncErrors_RunId_fkey` FOREIGN KEY (`RunId`) REFERENCES `RosterSyncRuns`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

