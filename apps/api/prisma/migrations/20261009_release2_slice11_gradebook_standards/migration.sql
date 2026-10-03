-- AlterTable
ALTER TABLE `Organizations` ADD COLUMN `GpaScale` TEXT NULL,
    ADD COLUMN `GradingScale` TEXT NULL;

-- AlterTable
ALTER TABLE `Classes` ADD COLUMN `GradingMode` ENUM('POINTS', 'STANDARDS') NOT NULL DEFAULT 'POINTS',
    ADD COLUMN `LatePolicy` TEXT NULL,
    ADD COLUMN `ProficiencyScaleId` CHAR(36) NULL,
    ADD COLUMN `Syllabus` TEXT NULL;

-- AlterTable
ALTER TABLE `Assignments` ADD COLUMN `CategoryId` CHAR(36) NULL,
    ADD COLUMN `GradingPeriodId` CHAR(36) NULL,
    ADD COLUMN `IsExtraCredit` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `GradeCategories` (
    `Id` CHAR(36) NOT NULL,
    `ClassId` CHAR(36) NOT NULL,
    `Name` VARCHAR(60) NOT NULL,
    `Weight` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `DropLowest` INTEGER NOT NULL DEFAULT 0,
    `SortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `GradeCategories_ClassId_Name_key`(`ClassId`, `Name`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssignmentMarks` (
    `Id` CHAR(36) NOT NULL,
    `AssignmentId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `Mark` ENUM('MISSING', 'EXCUSED', 'INCOMPLETE') NOT NULL,
    `Note` VARCHAR(500) NULL,
    `SetById` CHAR(36) NULL,
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `AssignmentMarks_AssignmentId_StudentId_key`(`AssignmentId`, `StudentId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StandardSets` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NULL,
    `Code` VARCHAR(40) NOT NULL,
    `Name` VARCHAR(200) NOT NULL,
    `Subject` VARCHAR(100) NULL,
    `Jurisdiction` VARCHAR(100) NULL,
    `SourceUri` VARCHAR(500) NULL,
    `Version` VARCHAR(40) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `StandardSets_OrganizationId_Code_idx`(`OrganizationId`, `Code`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Standards` (
    `Id` CHAR(36) NOT NULL,
    `SetId` CHAR(36) NOT NULL,
    `ParentId` CHAR(36) NULL,
    `Code` VARCHAR(80) NOT NULL,
    `Description` TEXT NOT NULL,
    `GradeLevels` VARCHAR(100) NULL,
    `SortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `Standards_SetId_GradeLevels_idx`(`SetId`, `GradeLevels`),
    UNIQUE INDEX `Standards_SetId_Code_key`(`SetId`, `Code`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssignmentStandards` (
    `AssignmentId` CHAR(36) NOT NULL,
    `StandardId` CHAR(36) NOT NULL,

    PRIMARY KEY (`AssignmentId`, `StandardId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LessonStandards` (
    `LessonId` CHAR(36) NOT NULL,
    `StandardId` CHAR(36) NOT NULL,

    PRIMARY KEY (`LessonId`, `StandardId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProficiencyScales` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `Name` VARCHAR(80) NOT NULL,
    `Levels` TEXT NOT NULL,
    `IsDefault` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `ProficiencyScales_OrganizationId_Name_key`(`OrganizationId`, `Name`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StandardScores` (
    `Id` CHAR(36) NOT NULL,
    `GradeId` CHAR(36) NOT NULL,
    `StandardId` CHAR(36) NOT NULL,
    `Level` INTEGER NOT NULL,
    `Label` VARCHAR(40) NOT NULL,

    UNIQUE INDEX `StandardScores_GradeId_StandardId_key`(`GradeId`, `StandardId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReportCards` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `GradingPeriodId` CHAR(36) NOT NULL,
    `Kind` ENUM('PROGRESS', 'REPORT_CARD') NOT NULL DEFAULT 'REPORT_CARD',
    `Status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `GPA` DECIMAL(4, 2) NULL,
    `Attendance` TEXT NULL,
    `GeneratedById` CHAR(36) NULL,
    `PublishedAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `ReportCards_OrganizationId_GradingPeriodId_Status_idx`(`OrganizationId`, `GradingPeriodId`, `Status`),
    UNIQUE INDEX `ReportCards_StudentId_GradingPeriodId_Kind_key`(`StudentId`, `GradingPeriodId`, `Kind`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReportCardLines` (
    `Id` CHAR(36) NOT NULL,
    `ReportCardId` CHAR(36) NOT NULL,
    `ClassId` CHAR(36) NOT NULL,
    `ClassName` VARCHAR(200) NOT NULL,
    `CourseTitle` VARCHAR(200) NOT NULL,
    `TeacherName` VARCHAR(200) NULL,
    `Percentage` DECIMAL(5, 2) NULL,
    `Letter` VARCHAR(4) NULL,
    `GpaPoints` DECIMAL(4, 2) NULL,
    `Categories` TEXT NULL,
    `Standards` TEXT NULL,
    `Comment` TEXT NULL,
    `CommentById` CHAR(36) NULL,
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `ReportCardLines_ReportCardId_ClassId_key`(`ReportCardId`, `ClassId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Classes` ADD CONSTRAINT `Classes_ProficiencyScaleId_fkey` FOREIGN KEY (`ProficiencyScaleId`) REFERENCES `ProficiencyScales`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assignments` ADD CONSTRAINT `Assignments_CategoryId_fkey` FOREIGN KEY (`CategoryId`) REFERENCES `GradeCategories`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assignments` ADD CONSTRAINT `Assignments_GradingPeriodId_fkey` FOREIGN KEY (`GradingPeriodId`) REFERENCES `GradingPeriods`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GradeCategories` ADD CONSTRAINT `GradeCategories_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssignmentMarks` ADD CONSTRAINT `AssignmentMarks_AssignmentId_fkey` FOREIGN KEY (`AssignmentId`) REFERENCES `Assignments`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssignmentMarks` ADD CONSTRAINT `AssignmentMarks_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StandardSets` ADD CONSTRAINT `StandardSets_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Standards` ADD CONSTRAINT `Standards_SetId_fkey` FOREIGN KEY (`SetId`) REFERENCES `StandardSets`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Standards` ADD CONSTRAINT `Standards_ParentId_fkey` FOREIGN KEY (`ParentId`) REFERENCES `Standards`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssignmentStandards` ADD CONSTRAINT `AssignmentStandards_AssignmentId_fkey` FOREIGN KEY (`AssignmentId`) REFERENCES `Assignments`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssignmentStandards` ADD CONSTRAINT `AssignmentStandards_StandardId_fkey` FOREIGN KEY (`StandardId`) REFERENCES `Standards`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LessonStandards` ADD CONSTRAINT `LessonStandards_LessonId_fkey` FOREIGN KEY (`LessonId`) REFERENCES `Lessons`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LessonStandards` ADD CONSTRAINT `LessonStandards_StandardId_fkey` FOREIGN KEY (`StandardId`) REFERENCES `Standards`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProficiencyScales` ADD CONSTRAINT `ProficiencyScales_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StandardScores` ADD CONSTRAINT `StandardScores_GradeId_fkey` FOREIGN KEY (`GradeId`) REFERENCES `Grades`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StandardScores` ADD CONSTRAINT `StandardScores_StandardId_fkey` FOREIGN KEY (`StandardId`) REFERENCES `Standards`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportCards` ADD CONSTRAINT `ReportCards_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportCards` ADD CONSTRAINT `ReportCards_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportCards` ADD CONSTRAINT `ReportCards_GradingPeriodId_fkey` FOREIGN KEY (`GradingPeriodId`) REFERENCES `GradingPeriods`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportCardLines` ADD CONSTRAINT `ReportCardLines_ReportCardId_fkey` FOREIGN KEY (`ReportCardId`) REFERENCES `ReportCards`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportCardLines` ADD CONSTRAINT `ReportCardLines_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

