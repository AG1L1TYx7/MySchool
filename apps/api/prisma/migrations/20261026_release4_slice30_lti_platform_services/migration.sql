-- CreateTable
CREATE TABLE `LtiToolLinks` (
    `Id` CHAR(36) NOT NULL,
    `ToolId` CHAR(36) NOT NULL,
    `ClassId` CHAR(36) NOT NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Url` VARCHAR(500) NOT NULL,
    `Custom` TEXT NULL,
    `LineItemId` CHAR(36) NULL,
    `CreatedById` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `LtiToolLinks_LineItemId_key`(`LineItemId`),
    INDEX `LtiToolLinks_ClassId_idx`(`ClassId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LtiLineItems` (
    `Id` CHAR(36) NOT NULL,
    `ToolId` CHAR(36) NOT NULL,
    `ClassId` CHAR(36) NOT NULL,
    `AssignmentId` CHAR(36) NULL,
    `Label` VARCHAR(200) NOT NULL,
    `ScoreMaximum` DECIMAL(9, 2) NOT NULL,
    `ResourceId` VARCHAR(255) NULL,
    `ResourceLinkId` VARCHAR(255) NULL,
    `Tag` VARCHAR(100) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `LtiLineItems_AssignmentId_key`(`AssignmentId`),
    INDEX `LtiLineItems_ToolId_ClassId_idx`(`ToolId`, `ClassId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LtiScores` (
    `Id` CHAR(36) NOT NULL,
    `LineItemId` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NOT NULL,
    `ScoreGiven` DECIMAL(9, 2) NULL,
    `ScoreMaximum` DECIMAL(9, 2) NOT NULL,
    `ActivityProgress` VARCHAR(32) NOT NULL,
    `GradingProgress` VARCHAR(32) NOT NULL,
    `Comment` TEXT NULL,
    `Timestamp` DATETIME(6) NOT NULL,
    `UpdatedAt` DATETIME(6) NOT NULL,

    UNIQUE INDEX `LtiScores_LineItemId_UserId_key`(`LineItemId`, `UserId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LtiToolLinks` ADD CONSTRAINT `LtiToolLinks_ToolId_fkey` FOREIGN KEY (`ToolId`) REFERENCES `LtiTools`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LtiToolLinks` ADD CONSTRAINT `LtiToolLinks_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LtiToolLinks` ADD CONSTRAINT `LtiToolLinks_LineItemId_fkey` FOREIGN KEY (`LineItemId`) REFERENCES `LtiLineItems`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LtiLineItems` ADD CONSTRAINT `LtiLineItems_ToolId_fkey` FOREIGN KEY (`ToolId`) REFERENCES `LtiTools`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LtiLineItems` ADD CONSTRAINT `LtiLineItems_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LtiLineItems` ADD CONSTRAINT `LtiLineItems_AssignmentId_fkey` FOREIGN KEY (`AssignmentId`) REFERENCES `Assignments`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LtiScores` ADD CONSTRAINT `LtiScores_LineItemId_fkey` FOREIGN KEY (`LineItemId`) REFERENCES `LtiLineItems`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

