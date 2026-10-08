-- CreateTable
CREATE TABLE `LibraryItems` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `CreatedById` CHAR(36) NULL,
    `Kind` VARCHAR(20) NOT NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Description` TEXT NULL,
    `Subject` VARCHAR(100) NULL,
    `GradeLevel` VARCHAR(16) NULL,
    `Topics` TEXT NULL,
    `Standards` TEXT NULL,
    `Keywords` VARCHAR(500) NULL,
    `Visibility` VARCHAR(16) NOT NULL DEFAULT 'private',
    `Status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `H5PContentId` CHAR(36) NULL,
    `FileId` CHAR(36) NULL,
    `Url` VARCHAR(500) NULL,
    `LessonPlanId` CHAR(36) NULL,
    `Version` INTEGER NOT NULL DEFAULT 1,
    `Featured` BOOLEAN NOT NULL DEFAULT false,
    `ViewCount` INTEGER NOT NULL DEFAULT 0,
    `DownloadCount` INTEGER NOT NULL DEFAULT 0,
    `CopyCount` INTEGER NOT NULL DEFAULT 0,
    `RatingSum` INTEGER NOT NULL DEFAULT 0,
    `RatingCount` INTEGER NOT NULL DEFAULT 0,
    `SourceItemId` CHAR(36) NULL,
    `PublishedAt` DATETIME(6) NULL,
    `ReviewedById` CHAR(36) NULL,
    `ReviewedAt` DATETIME(6) NULL,
    `ReviewNote` VARCHAR(500) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,
    `DeletedAt` DATETIME(6) NULL,

    INDEX `LibraryItems_OrganizationId_Status_DeletedAt_idx`(`OrganizationId`, `Status`, `DeletedAt`),
    INDEX `LibraryItems_Visibility_Status_PublishedAt_idx`(`Visibility`, `Status`, `PublishedAt`),
    INDEX `LibraryItems_Subject_GradeLevel_idx`(`Subject`, `GradeLevel`),
    INDEX `LibraryItems_CreatedById_idx`(`CreatedById`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LibraryItemVersions` (
    `Id` CHAR(36) NOT NULL,
    `ItemId` CHAR(36) NOT NULL,
    `Version` INTEGER NOT NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Description` TEXT NULL,
    `Snapshot` LONGTEXT NOT NULL,
    `Note` VARCHAR(300) NULL,
    `CreatedById` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `LibraryItemVersions_ItemId_Version_key`(`ItemId`, `Version`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LibraryRatings` (
    `Id` CHAR(36) NOT NULL,
    `ItemId` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `Stars` INTEGER NOT NULL,
    `Comment` VARCHAR(500) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `LibraryRatings_ItemId_UserId_key`(`ItemId`, `UserId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LibraryFlags` (
    `Id` CHAR(36) NOT NULL,
    `ItemId` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `Reason` VARCHAR(500) NOT NULL,
    `Status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `ResolvedById` CHAR(36) NULL,
    `ResolvedAt` DATETIME(6) NULL,
    `Resolution` VARCHAR(500) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `LibraryFlags_Status_CreatedAt_idx`(`Status`, `CreatedAt`),
    INDEX `LibraryFlags_ItemId_idx`(`ItemId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LibraryCollections` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `CreatedById` CHAR(36) NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Description` TEXT NULL,
    `Visibility` VARCHAR(16) NOT NULL DEFAULT 'private',
    `Featured` BOOLEAN NOT NULL DEFAULT false,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,
    `DeletedAt` DATETIME(6) NULL,

    INDEX `LibraryCollections_OrganizationId_Visibility_DeletedAt_idx`(`OrganizationId`, `Visibility`, `DeletedAt`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LibraryCollectionItems` (
    `Id` CHAR(36) NOT NULL,
    `CollectionId` CHAR(36) NOT NULL,
    `ItemId` CHAR(36) NOT NULL,
    `SortOrder` INTEGER NOT NULL DEFAULT 0,
    `AddedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `LibraryCollectionItems_CollectionId_ItemId_key`(`CollectionId`, `ItemId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LibraryCollectionFollowers` (
    `Id` CHAR(36) NOT NULL,
    `CollectionId` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `LibraryCollectionFollowers_CollectionId_UserId_key`(`CollectionId`, `UserId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LibraryItems` ADD CONSTRAINT `LibraryItems_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LibraryItems` ADD CONSTRAINT `LibraryItems_CreatedById_fkey` FOREIGN KEY (`CreatedById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LibraryItems` ADD CONSTRAINT `LibraryItems_H5PContentId_fkey` FOREIGN KEY (`H5PContentId`) REFERENCES `H5PContents`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LibraryItems` ADD CONSTRAINT `LibraryItems_FileId_fkey` FOREIGN KEY (`FileId`) REFERENCES `FileUploads`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LibraryItems` ADD CONSTRAINT `LibraryItems_LessonPlanId_fkey` FOREIGN KEY (`LessonPlanId`) REFERENCES `LessonPlans`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LibraryItemVersions` ADD CONSTRAINT `LibraryItemVersions_ItemId_fkey` FOREIGN KEY (`ItemId`) REFERENCES `LibraryItems`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LibraryRatings` ADD CONSTRAINT `LibraryRatings_ItemId_fkey` FOREIGN KEY (`ItemId`) REFERENCES `LibraryItems`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LibraryRatings` ADD CONSTRAINT `LibraryRatings_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LibraryFlags` ADD CONSTRAINT `LibraryFlags_ItemId_fkey` FOREIGN KEY (`ItemId`) REFERENCES `LibraryItems`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LibraryFlags` ADD CONSTRAINT `LibraryFlags_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LibraryCollections` ADD CONSTRAINT `LibraryCollections_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LibraryCollections` ADD CONSTRAINT `LibraryCollections_CreatedById_fkey` FOREIGN KEY (`CreatedById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LibraryCollectionItems` ADD CONSTRAINT `LibraryCollectionItems_CollectionId_fkey` FOREIGN KEY (`CollectionId`) REFERENCES `LibraryCollections`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LibraryCollectionItems` ADD CONSTRAINT `LibraryCollectionItems_ItemId_fkey` FOREIGN KEY (`ItemId`) REFERENCES `LibraryItems`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LibraryCollectionFollowers` ADD CONSTRAINT `LibraryCollectionFollowers_CollectionId_fkey` FOREIGN KEY (`CollectionId`) REFERENCES `LibraryCollections`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LibraryCollectionFollowers` ADD CONSTRAINT `LibraryCollectionFollowers_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

