-- CreateTable
CREATE TABLE `Portfolios` (
    `Id` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `Headline` VARCHAR(200) NULL,
    `About` TEXT NULL,
    `Visibility` VARCHAR(16) NOT NULL DEFAULT 'private',
    `Slug` VARCHAR(63) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `Portfolios_StudentId_key`(`StudentId`),
    UNIQUE INDEX `Portfolios_Slug_key`(`Slug`),
    INDEX `Portfolios_OrganizationId_Visibility_idx`(`OrganizationId`, `Visibility`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PortfolioProjects` (
    `Id` CHAR(36) NOT NULL,
    `PortfolioId` CHAR(36) NOT NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Summary` VARCHAR(500) NULL,
    `Description` TEXT NULL,
    `Kind` VARCHAR(20) NOT NULL DEFAULT 'project',
    `Status` VARCHAR(16) NOT NULL DEFAULT 'draft',
    `Featured` BOOLEAN NOT NULL DEFAULT false,
    `SortOrder` INTEGER NOT NULL DEFAULT 0,
    `Skills` TEXT NULL,
    `Reflection` TEXT NULL,
    `ExternalUrl` VARCHAR(500) NULL,
    `CompletedOn` DATE NULL,
    `SourceSubmissionId` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `PortfolioProjects_PortfolioId_Status_SortOrder_idx`(`PortfolioId`, `Status`, `SortOrder`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PortfolioMedia` (
    `Id` CHAR(36) NOT NULL,
    `ProjectId` CHAR(36) NOT NULL,
    `FileId` CHAR(36) NOT NULL,
    `Caption` VARCHAR(300) NULL,
    `SortOrder` INTEGER NOT NULL DEFAULT 0,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `PortfolioMedia_ProjectId_SortOrder_idx`(`ProjectId`, `SortOrder`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PortfolioReviews` (
    `Id` CHAR(36) NOT NULL,
    `ProjectId` CHAR(36) NOT NULL,
    `ReviewerId` CHAR(36) NOT NULL,
    `Comment` TEXT NOT NULL,
    `Stars` INTEGER NULL,
    `Hidden` BOOLEAN NOT NULL DEFAULT false,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `PortfolioReviews_ProjectId_ReviewerId_key`(`ProjectId`, `ReviewerId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Skills` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NULL,
    `Name` VARCHAR(100) NOT NULL,
    `Category` VARCHAR(50) NOT NULL,
    `Description` VARCHAR(500) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `Skills_Category_idx`(`Category`),
    UNIQUE INDEX `Skills_OrganizationId_Name_key`(`OrganizationId`, `Name`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StudentSkills` (
    `Id` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `SkillId` CHAR(36) NOT NULL,
    `Level` INTEGER NOT NULL DEFAULT 1,
    `Note` VARCHAR(500) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `StudentSkills_StudentId_SkillId_key`(`StudentId`, `SkillId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SkillEndorsements` (
    `Id` CHAR(36) NOT NULL,
    `StudentSkillId` CHAR(36) NOT NULL,
    `EndorserId` CHAR(36) NOT NULL,
    `Comment` VARCHAR(500) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `SkillEndorsements_StudentSkillId_EndorserId_key`(`StudentSkillId`, `EndorserId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CareerProfiles` (
    `Id` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `Goals` TEXT NULL,
    `Interests` TEXT NULL,
    `Pathways` TEXT NULL,
    `CollegePlans` TEXT NULL,
    `Checklist` TEXT NULL,
    `InventoryAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `CareerProfiles_StudentId_key`(`StudentId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CodeLessons` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Description` TEXT NOT NULL,
    `Language` VARCHAR(20) NOT NULL DEFAULT 'javascript',
    `Level` INTEGER NOT NULL DEFAULT 1,
    `SortOrder` INTEGER NOT NULL DEFAULT 0,
    `Starter` TEXT NOT NULL,
    `Tests` TEXT NOT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `CodeLessons_OrganizationId_SortOrder_idx`(`OrganizationId`, `SortOrder`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CodeSubmissions` (
    `Id` CHAR(36) NOT NULL,
    `LessonId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `Source` TEXT NOT NULL,
    `Status` VARCHAR(16) NOT NULL,
    `Passed` INTEGER NOT NULL DEFAULT 0,
    `Total` INTEGER NOT NULL DEFAULT 0,
    `Output` TEXT NULL,
    `RuntimeMs` INTEGER NOT NULL DEFAULT 0,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `CodeSubmissions_StudentId_LessonId_CreatedAt_idx`(`StudentId`, `LessonId`, `CreatedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Portfolios` ADD CONSTRAINT `Portfolios_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Portfolios` ADD CONSTRAINT `Portfolios_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PortfolioProjects` ADD CONSTRAINT `PortfolioProjects_PortfolioId_fkey` FOREIGN KEY (`PortfolioId`) REFERENCES `Portfolios`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PortfolioProjects` ADD CONSTRAINT `PortfolioProjects_SourceSubmissionId_fkey` FOREIGN KEY (`SourceSubmissionId`) REFERENCES `AssignmentSubmissions`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PortfolioMedia` ADD CONSTRAINT `PortfolioMedia_ProjectId_fkey` FOREIGN KEY (`ProjectId`) REFERENCES `PortfolioProjects`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PortfolioMedia` ADD CONSTRAINT `PortfolioMedia_FileId_fkey` FOREIGN KEY (`FileId`) REFERENCES `FileUploads`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PortfolioReviews` ADD CONSTRAINT `PortfolioReviews_ProjectId_fkey` FOREIGN KEY (`ProjectId`) REFERENCES `PortfolioProjects`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PortfolioReviews` ADD CONSTRAINT `PortfolioReviews_ReviewerId_fkey` FOREIGN KEY (`ReviewerId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Skills` ADD CONSTRAINT `Skills_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StudentSkills` ADD CONSTRAINT `StudentSkills_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StudentSkills` ADD CONSTRAINT `StudentSkills_SkillId_fkey` FOREIGN KEY (`SkillId`) REFERENCES `Skills`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SkillEndorsements` ADD CONSTRAINT `SkillEndorsements_StudentSkillId_fkey` FOREIGN KEY (`StudentSkillId`) REFERENCES `StudentSkills`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SkillEndorsements` ADD CONSTRAINT `SkillEndorsements_EndorserId_fkey` FOREIGN KEY (`EndorserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CareerProfiles` ADD CONSTRAINT `CareerProfiles_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CodeLessons` ADD CONSTRAINT `CodeLessons_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CodeSubmissions` ADD CONSTRAINT `CodeSubmissions_LessonId_fkey` FOREIGN KEY (`LessonId`) REFERENCES `CodeLessons`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CodeSubmissions` ADD CONSTRAINT `CodeSubmissions_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

