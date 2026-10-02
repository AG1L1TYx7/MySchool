-- CreateTable
CREATE TABLE `H5PLibraries` (
    `Id` CHAR(36) NOT NULL,
    `MachineName` VARCHAR(100) NOT NULL,
    `MajorVersion` INTEGER NOT NULL,
    `MinorVersion` INTEGER NOT NULL,
    `PatchVersion` INTEGER NOT NULL,
    `Title` VARCHAR(150) NOT NULL,
    `Runnable` BOOLEAN NOT NULL DEFAULT false,
    `Restricted` BOOLEAN NOT NULL DEFAULT false,
    `Dependencies` TEXT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `H5PLibraries_MachineName_MajorVersion_MinorVersion_PatchVers_key`(`MachineName`, `MajorVersion`, `MinorVersion`, `PatchVersion`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `H5PContents` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `CreatedById` CHAR(36) NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Library` VARCHAR(100) NOT NULL,
    `ContentType` VARCHAR(40) NOT NULL,
    `Parameters` LONGTEXT NOT NULL,
    `Draft` LONGTEXT NULL,
    `MaxScore` INTEGER NOT NULL DEFAULT 0,
    `Status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `Source` ENUM('AI', 'MANUAL') NOT NULL DEFAULT 'MANUAL',
    `Subject` VARCHAR(100) NULL,
    `GradeLevel` VARCHAR(10) NULL,
    `Topic` VARCHAR(200) NULL,
    `Difficulty` VARCHAR(20) NULL,
    `CourseId` CHAR(36) NULL,
    `LessonId` CHAR(36) NULL,
    `AiModel` VARCHAR(100) NULL,
    `PromptVersion` VARCHAR(60) NULL,
    `AiJobId` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,
    `DeletedAt` DATETIME(6) NULL,

    INDEX `H5PContents_OrganizationId_Status_DeletedAt_idx`(`OrganizationId`, `Status`, `DeletedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `H5PContentResults` (
    `Id` CHAR(36) NOT NULL,
    `ContentId` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NULL,
    `AssignmentId` CHAR(36) NULL,
    `Score` DECIMAL(7, 2) NOT NULL,
    `MaxScore` DECIMAL(7, 2) NOT NULL,
    `Completed` BOOLEAN NOT NULL DEFAULT true,
    `TimeSpentSeconds` INTEGER NULL,
    `Detail` TEXT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `H5PContentResults_ContentId_UserId_CreatedAt_idx`(`ContentId`, `UserId`, `CreatedAt`),
    INDEX `H5PContentResults_AssignmentId_StudentId_idx`(`AssignmentId`, `StudentId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiJobs` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NULL,
    `UserId` CHAR(36) NOT NULL,
    `Capability` VARCHAR(50) NOT NULL,
    `Status` ENUM('QUEUED', 'RUNNING', 'DONE', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `AiJobId` VARCHAR(64) NULL,
    `TraceId` CHAR(36) NOT NULL,
    `Request` TEXT NOT NULL,
    `Progress` VARCHAR(200) NULL,
    `ResultContentId` CHAR(36) NULL,
    `ErrorCode` VARCHAR(60) NULL,
    `ErrorDetail` TEXT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `AiJobs_UserId_CreatedAt_idx`(`UserId`, `CreatedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Assignments` ADD CONSTRAINT `Assignments_H5PContentId_fkey` FOREIGN KEY (`H5PContentId`) REFERENCES `H5PContents`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `H5PContents` ADD CONSTRAINT `H5PContents_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `H5PContents` ADD CONSTRAINT `H5PContents_CreatedById_fkey` FOREIGN KEY (`CreatedById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `H5PContentResults` ADD CONSTRAINT `H5PContentResults_ContentId_fkey` FOREIGN KEY (`ContentId`) REFERENCES `H5PContents`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `H5PContentResults` ADD CONSTRAINT `H5PContentResults_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `H5PContentResults` ADD CONSTRAINT `H5PContentResults_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `H5PContentResults` ADD CONSTRAINT `H5PContentResults_AssignmentId_fkey` FOREIGN KEY (`AssignmentId`) REFERENCES `Assignments`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiJobs` ADD CONSTRAINT `AiJobs_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiJobs` ADD CONSTRAINT `AiJobs_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

