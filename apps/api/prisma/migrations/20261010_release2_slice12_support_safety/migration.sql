-- AlterTable
ALTER TABLE `Organizations` ADD COLUMN `AiConsentDefault` VARCHAR(20) NOT NULL DEFAULT 'SCHOOL',
    ADD COLUMN `BehaviorVisibility` VARCHAR(20) NOT NULL DEFAULT 'POSITIVE_ONLY',
    ADD COLUMN `StudentMessaging` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Users` MODIFY `Role` ENUM('SUPER_ADMIN', 'SUPERINTENDENT', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT', 'ASSISTANT', 'COUNSELOR') NOT NULL;

-- AlterTable
ALTER TABLE `RoleFeatures` MODIFY `Role` ENUM('SUPER_ADMIN', 'SUPERINTENDENT', 'PRINCIPAL', 'TEACHER', 'STUDENT', 'PARENT', 'ASSISTANT', 'COUNSELOR') NOT NULL;

-- CreateTable
CREATE TABLE `Accommodations` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `Plan` ENUM('IEP', 'SECTION_504', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `ExtendedTimePercent` INTEGER NOT NULL DEFAULT 0,
    `ReadAloud` BOOLEAN NOT NULL DEFAULT false,
    `LargeText` BOOLEAN NOT NULL DEFAULT false,
    `ReducedMotion` BOOLEAN NOT NULL DEFAULT false,
    `ReducedDistraction` BOOLEAN NOT NULL DEFAULT false,
    `Notes` TEXT NULL,
    `StartDate` DATE NULL,
    `EndDate` DATE NULL,
    `UpdatedById` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `Accommodations_StudentId_key`(`StudentId`),
    INDEX `Accommodations_OrganizationId_Plan_idx`(`OrganizationId`, `Plan`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CounselorCaseloads` (
    `Id` CHAR(36) NOT NULL,
    `CounselorId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `Reason` VARCHAR(200) NULL,
    `AssignedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `CounselorCaseloads_StudentId_idx`(`StudentId`),
    UNIQUE INDEX `CounselorCaseloads_CounselorId_StudentId_key`(`CounselorId`, `StudentId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CounselorNotes` (
    `Id` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `AuthorId` CHAR(36) NOT NULL,
    `Body` TEXT NOT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `CounselorNotes_StudentId_CreatedAt_idx`(`StudentId`, `CreatedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WellnessAlerts` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NULL,
    `UserId` CHAR(36) NOT NULL,
    `ConversationId` CHAR(36) NULL,
    `MessageId` CHAR(36) NULL,
    `Categories` VARCHAR(200) NOT NULL,
    `Excerpt` TEXT NOT NULL,
    `Status` ENUM('OPEN', 'ACKNOWLEDGED', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `AssignedToId` CHAR(36) NULL,
    `Resolution` TEXT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,
    `ResolvedAt` DATETIME(6) NULL,

    INDEX `WellnessAlerts_OrganizationId_Status_CreatedAt_idx`(`OrganizationId`, `Status`, `CreatedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BehaviorRecords` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `ReportedById` CHAR(36) NOT NULL,
    `Kind` ENUM('POSITIVE', 'CONCERN', 'INCIDENT') NOT NULL DEFAULT 'CONCERN',
    `Title` VARCHAR(200) NOT NULL,
    `Description` TEXT NULL,
    `OccurredAt` DATETIME(6) NOT NULL,
    `Location` VARCHAR(100) NULL,
    `ActionTaken` TEXT NULL,
    `ParentVisible` BOOLEAN NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `BehaviorRecords_StudentId_OccurredAt_idx`(`StudentId`, `OccurredAt`),
    INDEX `BehaviorRecords_OrganizationId_Kind_OccurredAt_idx`(`OrganizationId`, `Kind`, `OccurredAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiConsents` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `Status` ENUM('GRANTED', 'DECLINED', 'PENDING') NOT NULL DEFAULT 'PENDING',
    `DecidedBy` VARCHAR(20) NULL,
    `DecidedById` CHAR(36) NULL,
    `Note` VARCHAR(500) NULL,
    `DecidedAt` DATETIME(6) NULL,
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `AiConsents_StudentId_key`(`StudentId`),
    INDEX `AiConsents_OrganizationId_Status_idx`(`OrganizationId`, `Status`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Accommodations` ADD CONSTRAINT `Accommodations_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Accommodations` ADD CONSTRAINT `Accommodations_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CounselorCaseloads` ADD CONSTRAINT `CounselorCaseloads_CounselorId_fkey` FOREIGN KEY (`CounselorId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CounselorCaseloads` ADD CONSTRAINT `CounselorCaseloads_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CounselorNotes` ADD CONSTRAINT `CounselorNotes_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CounselorNotes` ADD CONSTRAINT `CounselorNotes_AuthorId_fkey` FOREIGN KEY (`AuthorId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WellnessAlerts` ADD CONSTRAINT `WellnessAlerts_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WellnessAlerts` ADD CONSTRAINT `WellnessAlerts_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WellnessAlerts` ADD CONSTRAINT `WellnessAlerts_AssignedToId_fkey` FOREIGN KEY (`AssignedToId`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BehaviorRecords` ADD CONSTRAINT `BehaviorRecords_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BehaviorRecords` ADD CONSTRAINT `BehaviorRecords_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BehaviorRecords` ADD CONSTRAINT `BehaviorRecords_ReportedById_fkey` FOREIGN KEY (`ReportedById`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiConsents` ADD CONSTRAINT `AiConsents_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiConsents` ADD CONSTRAINT `AiConsents_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

