-- CreateTable
CREATE TABLE `Students` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `UserId` CHAR(36) NULL,
    `StudentNumber` VARCHAR(50) NOT NULL,
    `FirstName` VARCHAR(100) NOT NULL,
    `LastName` VARCHAR(100) NOT NULL,
    `Email` VARCHAR(256) NULL,
    `Phone` VARCHAR(32) NULL,
    `DateOfBirth` DATE NULL,
    `Gender` VARCHAR(32) NULL,
    `GradeLevel` VARCHAR(16) NULL,
    `EnrollmentStatus` ENUM('ACTIVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED', 'WITHDRAWN', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `EnrollmentDate` DATE NULL,
    `PreferredLearningStyle` ENUM('VISUAL', 'AUDITORY', 'KINESTHETIC', 'READING_WRITING', 'MIXED') NULL,
    `AccessibilityNeeds` TEXT NULL,
    `Goals` TEXT NULL,
    `Notes` TEXT NULL,
    `Address` VARCHAR(500) NULL,
    `GPA` DECIMAL(4, 2) NULL,
    `AttendanceRate` DECIMAL(5, 2) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,
    `DeletedAt` DATETIME(6) NULL,

    UNIQUE INDEX `Students_UserId_key`(`UserId`),
    INDEX `Students_OrganizationId_EnrollmentStatus_DeletedAt_idx`(`OrganizationId`, `EnrollmentStatus`, `DeletedAt`),
    INDEX `Students_OrganizationId_GradeLevel_idx`(`OrganizationId`, `GradeLevel`),
    INDEX `Students_LastName_FirstName_idx`(`LastName`, `FirstName`),
    UNIQUE INDEX `Students_OrganizationId_StudentNumber_key`(`OrganizationId`, `StudentNumber`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StudentGuardians` (
    `Id` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `GuardianUserId` CHAR(36) NOT NULL,
    `Relationship` ENUM('MOTHER', 'FATHER', 'GUARDIAN', 'GRANDPARENT', 'SIBLING', 'OTHER') NOT NULL DEFAULT 'GUARDIAN',
    `IsPrimary` BOOLEAN NOT NULL DEFAULT false,
    `ReceivesNotifications` BOOLEAN NOT NULL DEFAULT true,
    `CanViewGrades` BOOLEAN NOT NULL DEFAULT true,
    `CanViewAttendance` BOOLEAN NOT NULL DEFAULT true,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `StudentGuardians_GuardianUserId_idx`(`GuardianUserId`),
    UNIQUE INDEX `StudentGuardians_StudentId_GuardianUserId_key`(`StudentId`, `GuardianUserId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Students` ADD CONSTRAINT `Students_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Students` ADD CONSTRAINT `Students_UserId_fkey` FOREIGN KEY (`UserId`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StudentGuardians` ADD CONSTRAINT `StudentGuardians_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StudentGuardians` ADD CONSTRAINT `StudentGuardians_GuardianUserId_fkey` FOREIGN KEY (`GuardianUserId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

