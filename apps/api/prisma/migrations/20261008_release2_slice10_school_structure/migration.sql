-- AlterTable
ALTER TABLE `Organizations` ADD COLUMN `AttendanceDeadlineTime` VARCHAR(5) NULL,
    ADD COLUMN `GradeLevels` VARCHAR(100) NULL;

-- AlterTable
ALTER TABLE `Users` ADD COLUMN `IcalToken` VARCHAR(64) NULL;

-- AlterTable
ALTER TABLE `Classes` ADD COLUMN `AcademicYearId` CHAR(36) NULL,
    ADD COLUMN `GradeLevel` VARCHAR(16) NULL,
    ADD COLUMN `PeriodId` CHAR(36) NULL,
    ADD COLUMN `TermId` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `Attendances` ADD COLUMN `CodeId` CHAR(36) NULL,
    ADD COLUMN `PeriodId` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `AcademicYears` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `Name` VARCHAR(50) NOT NULL,
    `StartDate` DATE NOT NULL,
    `EndDate` DATE NOT NULL,
    `IsCurrent` BOOLEAN NOT NULL DEFAULT false,
    `ExternalId` VARCHAR(128) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `AcademicYears_OrganizationId_Name_key`(`OrganizationId`, `Name`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Terms` (
    `Id` CHAR(36) NOT NULL,
    `AcademicYearId` CHAR(36) NOT NULL,
    `Name` VARCHAR(50) NOT NULL,
    `Type` ENUM('SEMESTER', 'TRIMESTER', 'QUARTER', 'TERM') NOT NULL DEFAULT 'SEMESTER',
    `StartDate` DATE NOT NULL,
    `EndDate` DATE NOT NULL,
    `SortOrder` INTEGER NOT NULL DEFAULT 0,
    `ExternalId` VARCHAR(128) NULL,

    UNIQUE INDEX `Terms_AcademicYearId_Name_key`(`AcademicYearId`, `Name`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GradingPeriods` (
    `Id` CHAR(36) NOT NULL,
    `TermId` CHAR(36) NOT NULL,
    `Name` VARCHAR(50) NOT NULL,
    `StartDate` DATE NOT NULL,
    `EndDate` DATE NOT NULL,
    `SortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `GradingPeriods_TermId_Name_key`(`TermId`, `Name`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BellSchedules` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `Name` VARCHAR(80) NOT NULL,
    `IsDefault` BOOLEAN NOT NULL DEFAULT false,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `BellSchedules_OrganizationId_Name_key`(`OrganizationId`, `Name`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Periods` (
    `Id` CHAR(36) NOT NULL,
    `BellScheduleId` CHAR(36) NOT NULL,
    `Name` VARCHAR(20) NOT NULL,
    `StartTime` VARCHAR(5) NOT NULL,
    `EndTime` VARCHAR(5) NOT NULL,
    `Days` VARCHAR(7) NOT NULL DEFAULT 'MTWRF',
    `SortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `Periods_BellScheduleId_Name_key`(`BellScheduleId`, `Name`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AttendanceCodes` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `Code` VARCHAR(10) NOT NULL,
    `Label` VARCHAR(60) NOT NULL,
    `Category` ENUM('PRESENT', 'TARDY', 'EXCUSED', 'UNEXCUSED', 'REMOTE', 'OTHER') NOT NULL,
    `CountsAsPresent` BOOLEAN NOT NULL DEFAULT false,
    `IsActive` BOOLEAN NOT NULL DEFAULT true,
    `SortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `AttendanceCodes_OrganizationId_Code_key`(`OrganizationId`, `Code`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CalendarEvents` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `ClassId` CHAR(36) NULL,
    `Type` ENUM('DAY_OFF', 'EARLY_RELEASE', 'TERM_START', 'TERM_END', 'SCHOOL_EVENT', 'CLASS_EVENT') NOT NULL DEFAULT 'SCHOOL_EVENT',
    `Title` VARCHAR(200) NOT NULL,
    `Description` TEXT NULL,
    `StartsAt` DATETIME(6) NOT NULL,
    `EndsAt` DATETIME(6) NULL,
    `AllDay` BOOLEAN NOT NULL DEFAULT true,
    `CreatedById` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `CalendarEvents_OrganizationId_StartsAt_idx`(`OrganizationId`, `StartsAt`),
    INDEX `CalendarEvents_ClassId_StartsAt_idx`(`ClassId`, `StartsAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Users_IcalToken_key` ON `Users`(`IcalToken`);

-- AddForeignKey
ALTER TABLE `Classes` ADD CONSTRAINT `Classes_AcademicYearId_fkey` FOREIGN KEY (`AcademicYearId`) REFERENCES `AcademicYears`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Classes` ADD CONSTRAINT `Classes_TermId_fkey` FOREIGN KEY (`TermId`) REFERENCES `Terms`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Classes` ADD CONSTRAINT `Classes_PeriodId_fkey` FOREIGN KEY (`PeriodId`) REFERENCES `Periods`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attendances` ADD CONSTRAINT `Attendances_CodeId_fkey` FOREIGN KEY (`CodeId`) REFERENCES `AttendanceCodes`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attendances` ADD CONSTRAINT `Attendances_PeriodId_fkey` FOREIGN KEY (`PeriodId`) REFERENCES `Periods`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AcademicYears` ADD CONSTRAINT `AcademicYears_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Terms` ADD CONSTRAINT `Terms_AcademicYearId_fkey` FOREIGN KEY (`AcademicYearId`) REFERENCES `AcademicYears`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GradingPeriods` ADD CONSTRAINT `GradingPeriods_TermId_fkey` FOREIGN KEY (`TermId`) REFERENCES `Terms`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BellSchedules` ADD CONSTRAINT `BellSchedules_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Periods` ADD CONSTRAINT `Periods_BellScheduleId_fkey` FOREIGN KEY (`BellScheduleId`) REFERENCES `BellSchedules`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AttendanceCodes` ADD CONSTRAINT `AttendanceCodes_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalendarEvents` ADD CONSTRAINT `CalendarEvents_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalendarEvents` ADD CONSTRAINT `CalendarEvents_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalendarEvents` ADD CONSTRAINT `CalendarEvents_CreatedById_fkey` FOREIGN KEY (`CreatedById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

