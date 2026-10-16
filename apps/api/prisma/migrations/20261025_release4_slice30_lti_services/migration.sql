-- AlterTable
ALTER TABLE `Users` MODIFY `Source` ENUM('MANUAL', 'ONEROSTER', 'CLEVER', 'CLASSLINK', 'LTI') NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE `Students` MODIFY `Source` ENUM('MANUAL', 'ONEROSTER', 'CLEVER', 'CLASSLINK', 'LTI') NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE `StudentGuardians` MODIFY `Source` ENUM('MANUAL', 'ONEROSTER', 'CLEVER', 'CLASSLINK', 'LTI') NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE `Courses` MODIFY `Source` ENUM('MANUAL', 'ONEROSTER', 'CLEVER', 'CLASSLINK', 'LTI') NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE `Classes` MODIFY `Source` ENUM('MANUAL', 'ONEROSTER', 'CLEVER', 'CLASSLINK', 'LTI') NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE `ClassEnrollments` MODIFY `Source` ENUM('MANUAL', 'ONEROSTER', 'CLEVER', 'CLASSLINK', 'LTI') NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE `LtiContextLinks` (
    `Id` CHAR(36) NOT NULL,
    `PlatformId` CHAR(36) NOT NULL,
    `ContextId` VARCHAR(255) NOT NULL,
    `ContextTitle` VARCHAR(200) NULL,
    `ClassId` CHAR(36) NULL,
    `MembershipsUrl` VARCHAR(500) NULL,
    `LineItemsUrl` VARCHAR(500) NULL,
    `Scopes` TEXT NULL,
    `LastSyncAt` DATETIME(6) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `LtiContextLinks_ClassId_idx`(`ClassId`),
    UNIQUE INDEX `LtiContextLinks_PlatformId_ContextId_key`(`PlatformId`, `ContextId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LtiLineItemLinks` (
    `Id` CHAR(36) NOT NULL,
    `ContextLinkId` CHAR(36) NOT NULL,
    `AssignmentId` CHAR(36) NOT NULL,
    `LineItemUrl` VARCHAR(500) NOT NULL,
    `ResourceLinkId` VARCHAR(255) NULL,
    `LastPushAt` DATETIME(6) NULL,
    `LastError` VARCHAR(500) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `LtiLineItemLinks_AssignmentId_idx`(`AssignmentId`),
    UNIQUE INDEX `LtiLineItemLinks_ContextLinkId_AssignmentId_key`(`ContextLinkId`, `AssignmentId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LtiContextLinks` ADD CONSTRAINT `LtiContextLinks_PlatformId_fkey` FOREIGN KEY (`PlatformId`) REFERENCES `LtiPlatforms`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LtiContextLinks` ADD CONSTRAINT `LtiContextLinks_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LtiLineItemLinks` ADD CONSTRAINT `LtiLineItemLinks_ContextLinkId_fkey` FOREIGN KEY (`ContextLinkId`) REFERENCES `LtiContextLinks`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LtiLineItemLinks` ADD CONSTRAINT `LtiLineItemLinks_AssignmentId_fkey` FOREIGN KEY (`AssignmentId`) REFERENCES `Assignments`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

