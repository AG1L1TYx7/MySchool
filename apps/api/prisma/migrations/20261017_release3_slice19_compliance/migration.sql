-- AlterTable
ALTER TABLE `Organizations` ADD COLUMN `RetentionPolicy` TEXT NULL;

-- AlterTable
ALTER TABLE `Students` ADD COLUMN `LegalHold` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `DeletionRequests` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NULL,
    `StudentName` VARCHAR(200) NOT NULL,
    `StudentNumber` VARCHAR(50) NOT NULL,
    `RequestedById` CHAR(36) NOT NULL,
    `Reason` VARCHAR(1000) NULL,
    `Status` VARCHAR(12) NOT NULL DEFAULT 'pending',
    `ScheduledFor` DATETIME(6) NULL,
    `DecidedById` CHAR(36) NULL,
    `DecidedAt` DATETIME(6) NULL,
    `CompletedAt` DATETIME(6) NULL,
    `Summary` TEXT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `DeletionRequests_OrganizationId_Status_idx`(`OrganizationId`, `Status`),
    INDEX `DeletionRequests_Status_ScheduledFor_idx`(`Status`, `ScheduledFor`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SecurityIncidents` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Severity` VARCHAR(10) NOT NULL,
    `Status` VARCHAR(12) NOT NULL DEFAULT 'open',
    `Summary` TEXT NOT NULL,
    `AffectedCount` INTEGER NOT NULL DEFAULT 0,
    `DataCategories` VARCHAR(500) NULL,
    `DetectedAt` DATETIME(6) NOT NULL,
    `ContainedAt` DATETIME(6) NULL,
    `NotifiedAt` DATETIME(6) NULL,
    `ClosedAt` DATETIME(6) NULL,
    `Timeline` TEXT NOT NULL DEFAULT '[]',
    `ReportedById` CHAR(36) NOT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `SecurityIncidents_OrganizationId_Status_idx`(`OrganizationId`, `Status`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DeletionRequests` ADD CONSTRAINT `DeletionRequests_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeletionRequests` ADD CONSTRAINT `DeletionRequests_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeletionRequests` ADD CONSTRAINT `DeletionRequests_RequestedById_fkey` FOREIGN KEY (`RequestedById`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SecurityIncidents` ADD CONSTRAINT `SecurityIncidents_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SecurityIncidents` ADD CONSTRAINT `SecurityIncidents_ReportedById_fkey` FOREIGN KEY (`ReportedById`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

