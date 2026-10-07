-- CreateTable
CREATE TABLE `ReportSchedules` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `Name` VARCHAR(120) NOT NULL,
    `Kind` VARCHAR(40) NOT NULL,
    `Frequency` VARCHAR(10) NOT NULL,
    `DayOfWeek` INTEGER NULL,
    `DayOfMonth` INTEGER NULL,
    `Hour` INTEGER NOT NULL DEFAULT 7,
    `ClassId` CHAR(36) NULL,
    `Recipients` TEXT NOT NULL,
    `Active` BOOLEAN NOT NULL DEFAULT true,
    `CreatedById` CHAR(36) NOT NULL,
    `LastRunAt` DATETIME(6) NULL,
    `NextRunAt` DATETIME(6) NOT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `ReportSchedules_OrganizationId_Active_idx`(`OrganizationId`, `Active`),
    INDEX `ReportSchedules_Active_NextRunAt_idx`(`Active`, `NextRunAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReportRuns` (
    `Id` CHAR(36) NOT NULL,
    `ScheduleId` CHAR(36) NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `Kind` VARCHAR(40) NOT NULL,
    `Status` VARCHAR(10) NOT NULL,
    `Delivered` BOOLEAN NOT NULL DEFAULT false,
    `Recipients` TEXT NOT NULL,
    `RowCount` INTEGER NOT NULL DEFAULT 0,
    `FileName` VARCHAR(160) NOT NULL,
    `Error` TEXT NULL,
    `StartedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `FinishedAt` DATETIME(6) NULL,

    INDEX `ReportRuns_OrganizationId_StartedAt_idx`(`OrganizationId`, `StartedAt`),
    INDEX `ReportRuns_ScheduleId_StartedAt_idx`(`ScheduleId`, `StartedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ReportSchedules` ADD CONSTRAINT `ReportSchedules_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportSchedules` ADD CONSTRAINT `ReportSchedules_CreatedById_fkey` FOREIGN KEY (`CreatedById`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportRuns` ADD CONSTRAINT `ReportRuns_ScheduleId_fkey` FOREIGN KEY (`ScheduleId`) REFERENCES `ReportSchedules`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportRuns` ADD CONSTRAINT `ReportRuns_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

