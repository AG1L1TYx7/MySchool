-- CreateTable
CREATE TABLE `FileUploads` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NULL,
    `UploaderId` CHAR(36) NOT NULL,
    `OriginalName` VARCHAR(255) NOT NULL,
    `StoredPath` VARCHAR(500) NOT NULL,
    `MimeType` VARCHAR(127) NOT NULL,
    `SizeBytes` INTEGER NOT NULL,
    `Sha256` CHAR(64) NOT NULL,
    `Category` VARCHAR(50) NOT NULL DEFAULT 'general',
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `DeletedAt` DATETIME(6) NULL,

    INDEX `FileUploads_OrganizationId_Category_DeletedAt_idx`(`OrganizationId`, `Category`, `DeletedAt`),
    INDEX `FileUploads_UploaderId_idx`(`UploaderId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Rubrics` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `CreatedById` CHAR(36) NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Description` TEXT NULL,
    `Criteria` TEXT NOT NULL,
    `IsTemplate` BOOLEAN NOT NULL DEFAULT false,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,
    `DeletedAt` DATETIME(6) NULL,

    INDEX `Rubrics_OrganizationId_DeletedAt_idx`(`OrganizationId`, `DeletedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Assignments` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `ClassId` CHAR(36) NOT NULL,
    `CreatedById` CHAR(36) NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Description` TEXT NULL,
    `Instructions` TEXT NULL,
    `Type` ENUM('HOMEWORK', 'QUIZ', 'TEST', 'PROJECT', 'ESSAY', 'PRESENTATION', 'LAB', 'DISCUSSION', 'PRACTICE') NOT NULL DEFAULT 'HOMEWORK',
    `SubmissionType` ENUM('ONLINE', 'PAPER', 'IN_PERSON', 'EXTERNAL', 'NO_SUBMISSION') NOT NULL DEFAULT 'ONLINE',
    `Category` VARCHAR(50) NULL,
    `MaxPoints` DECIMAL(7, 2) NOT NULL DEFAULT 100,
    `Weight` DECIMAL(5, 2) NOT NULL DEFAULT 1,
    `AvailableFrom` DATETIME(6) NULL,
    `DueAt` DATETIME(6) NULL,
    `AllowLateUntil` DATETIME(6) NULL,
    `LatePenaltyPercent` INTEGER NULL,
    `MaxAttempts` INTEGER NULL,
    `RubricId` CHAR(36) NULL,
    `H5PContentId` CHAR(36) NULL,
    `Status` ENUM('DRAFT', 'PUBLISHED', 'CLOSED') NOT NULL DEFAULT 'DRAFT',
    `PublishedAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,
    `DeletedAt` DATETIME(6) NULL,

    INDEX `Assignments_ClassId_Status_DueAt_idx`(`ClassId`, `Status`, `DueAt`),
    INDEX `Assignments_OrganizationId_DeletedAt_idx`(`OrganizationId`, `DeletedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssignmentSubmissions` (
    `Id` CHAR(36) NOT NULL,
    `AssignmentId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `AttemptNumber` INTEGER NOT NULL DEFAULT 1,
    `Status` ENUM('SUBMITTED', 'LATE', 'GRADED', 'RETURNED') NOT NULL DEFAULT 'SUBMITTED',
    `TextContent` LONGTEXT NULL,
    `IsLate` BOOLEAN NOT NULL DEFAULT false,
    `SubmittedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `AssignmentSubmissions_StudentId_SubmittedAt_idx`(`StudentId`, `SubmittedAt`),
    UNIQUE INDEX `AssignmentSubmissions_AssignmentId_StudentId_AttemptNumber_key`(`AssignmentId`, `StudentId`, `AttemptNumber`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubmissionFiles` (
    `Id` CHAR(36) NOT NULL,
    `SubmissionId` CHAR(36) NOT NULL,
    `FileId` CHAR(36) NOT NULL,

    INDEX `SubmissionFiles_FileId_idx`(`FileId`),
    UNIQUE INDEX `SubmissionFiles_SubmissionId_FileId_key`(`SubmissionId`, `FileId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Grades` (
    `Id` CHAR(36) NOT NULL,
    `AssignmentId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `SubmissionId` CHAR(36) NULL,
    `GradedById` CHAR(36) NULL,
    `Score` DECIMAL(7, 2) NOT NULL,
    `MaxPoints` DECIMAL(7, 2) NOT NULL,
    `Percentage` DECIMAL(5, 2) NOT NULL,
    `LetterGrade` VARCHAR(4) NULL,
    `Feedback` TEXT NULL,
    `RubricScores` TEXT NULL,
    `LatePenaltyApplied` INTEGER NULL,
    `GradedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `Grades_SubmissionId_key`(`SubmissionId`),
    INDEX `Grades_StudentId_GradedAt_idx`(`StudentId`, `GradedAt`),
    UNIQUE INDEX `Grades_AssignmentId_StudentId_key`(`AssignmentId`, `StudentId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Attendances` (
    `Id` CHAR(36) NOT NULL,
    `ClassId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `Date` DATE NOT NULL,
    `Status` ENUM('PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'TARDY', 'LEFT_EARLY') NOT NULL,
    `Notes` VARCHAR(500) NULL,
    `MarkedById` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `Attendances_StudentId_Date_idx`(`StudentId`, `Date`),
    INDEX `Attendances_ClassId_Date_idx`(`ClassId`, `Date`),
    UNIQUE INDEX `Attendances_ClassId_StudentId_Date_key`(`ClassId`, `StudentId`, `Date`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `FileUploads` ADD CONSTRAINT `FileUploads_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FileUploads` ADD CONSTRAINT `FileUploads_UploaderId_fkey` FOREIGN KEY (`UploaderId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rubrics` ADD CONSTRAINT `Rubrics_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Rubrics` ADD CONSTRAINT `Rubrics_CreatedById_fkey` FOREIGN KEY (`CreatedById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assignments` ADD CONSTRAINT `Assignments_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assignments` ADD CONSTRAINT `Assignments_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assignments` ADD CONSTRAINT `Assignments_CreatedById_fkey` FOREIGN KEY (`CreatedById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assignments` ADD CONSTRAINT `Assignments_RubricId_fkey` FOREIGN KEY (`RubricId`) REFERENCES `Rubrics`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssignmentSubmissions` ADD CONSTRAINT `AssignmentSubmissions_AssignmentId_fkey` FOREIGN KEY (`AssignmentId`) REFERENCES `Assignments`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssignmentSubmissions` ADD CONSTRAINT `AssignmentSubmissions_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubmissionFiles` ADD CONSTRAINT `SubmissionFiles_SubmissionId_fkey` FOREIGN KEY (`SubmissionId`) REFERENCES `AssignmentSubmissions`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubmissionFiles` ADD CONSTRAINT `SubmissionFiles_FileId_fkey` FOREIGN KEY (`FileId`) REFERENCES `FileUploads`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Grades` ADD CONSTRAINT `Grades_AssignmentId_fkey` FOREIGN KEY (`AssignmentId`) REFERENCES `Assignments`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Grades` ADD CONSTRAINT `Grades_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Grades` ADD CONSTRAINT `Grades_SubmissionId_fkey` FOREIGN KEY (`SubmissionId`) REFERENCES `AssignmentSubmissions`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Grades` ADD CONSTRAINT `Grades_GradedById_fkey` FOREIGN KEY (`GradedById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attendances` ADD CONSTRAINT `Attendances_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attendances` ADD CONSTRAINT `Attendances_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attendances` ADD CONSTRAINT `Attendances_MarkedById_fkey` FOREIGN KEY (`MarkedById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

