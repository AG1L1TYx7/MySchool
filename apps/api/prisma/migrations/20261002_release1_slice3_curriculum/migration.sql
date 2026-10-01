-- CreateTable
CREATE TABLE `Courses` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `CourseCode` VARCHAR(50) NOT NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Description` TEXT NULL,
    `Subject` VARCHAR(100) NULL,
    `GradeLevel` VARCHAR(16) NULL,
    `CreditHours` DECIMAL(4, 2) NULL,
    `EstimatedHours` INTEGER NULL,
    `Status` ENUM('DRAFT', 'ACTIVE', 'ARCHIVED', 'UNDER_REVIEW') NOT NULL DEFAULT 'DRAFT',
    `IsPublished` BOOLEAN NOT NULL DEFAULT false,
    `PublishedAt` DATETIME(6) NULL,
    `InstructorId` CHAR(36) NULL,
    `CreatedById` CHAR(36) NULL,
    `ClonedFromId` CHAR(36) NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,
    `DeletedAt` DATETIME(6) NULL,

    INDEX `Courses_OrganizationId_Status_DeletedAt_idx`(`OrganizationId`, `Status`, `DeletedAt`),
    INDEX `Courses_OrganizationId_Subject_GradeLevel_idx`(`OrganizationId`, `Subject`, `GradeLevel`),
    INDEX `Courses_InstructorId_idx`(`InstructorId`),
    UNIQUE INDEX `Courses_OrganizationId_CourseCode_key`(`OrganizationId`, `CourseCode`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CoursePrerequisites` (
    `Id` CHAR(36) NOT NULL,
    `CourseId` CHAR(36) NOT NULL,
    `PrerequisiteCourseId` CHAR(36) NOT NULL,

    INDEX `CoursePrerequisites_PrerequisiteCourseId_idx`(`PrerequisiteCourseId`),
    UNIQUE INDEX `CoursePrerequisites_CourseId_PrerequisiteCourseId_key`(`CourseId`, `PrerequisiteCourseId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Modules` (
    `Id` CHAR(36) NOT NULL,
    `CourseId` CHAR(36) NOT NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Description` TEXT NULL,
    `SortOrder` INTEGER NOT NULL DEFAULT 0,
    `IsPublished` BOOLEAN NOT NULL DEFAULT true,
    `EstimatedMinutes` INTEGER NULL,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `Modules_CourseId_SortOrder_idx`(`CourseId`, `SortOrder`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Lessons` (
    `Id` CHAR(36) NOT NULL,
    `ModuleId` CHAR(36) NOT NULL,
    `Title` VARCHAR(200) NOT NULL,
    `Description` TEXT NULL,
    `LessonType` ENUM('TEXT', 'VIDEO', 'DOCUMENT', 'LINK', 'INTERACTIVE') NOT NULL DEFAULT 'TEXT',
    `Content` LONGTEXT NULL,
    `ContentUrl` VARCHAR(2000) NULL,
    `H5PContentId` CHAR(36) NULL,
    `SortOrder` INTEGER NOT NULL DEFAULT 0,
    `DurationMinutes` INTEGER NULL,
    `IsPublished` BOOLEAN NOT NULL DEFAULT true,
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `Lessons_ModuleId_SortOrder_idx`(`ModuleId`, `SortOrder`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Classes` (
    `Id` CHAR(36) NOT NULL,
    `OrganizationId` CHAR(36) NOT NULL,
    `CourseId` CHAR(36) NOT NULL,
    `Name` VARCHAR(200) NOT NULL,
    `Section` VARCHAR(50) NULL,
    `Term` VARCHAR(50) NOT NULL,
    `StartDate` DATE NULL,
    `EndDate` DATE NULL,
    `Room` VARCHAR(100) NULL,
    `MeetingSchedule` TEXT NULL,
    `MaxStudents` INTEGER NULL,
    `Status` ENUM('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `CreatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `UpdatedAt` DATETIME(6) NOT NULL,
    `DeletedAt` DATETIME(6) NULL,

    INDEX `Classes_OrganizationId_Term_Status_DeletedAt_idx`(`OrganizationId`, `Term`, `Status`, `DeletedAt`),
    INDEX `Classes_CourseId_idx`(`CourseId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClassTeachers` (
    `Id` CHAR(36) NOT NULL,
    `ClassId` CHAR(36) NOT NULL,
    `TeacherId` CHAR(36) NOT NULL,
    `IsPrimary` BOOLEAN NOT NULL DEFAULT false,
    `AssignedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `ClassTeachers_TeacherId_idx`(`TeacherId`),
    UNIQUE INDEX `ClassTeachers_ClassId_TeacherId_key`(`ClassId`, `TeacherId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClassEnrollments` (
    `Id` CHAR(36) NOT NULL,
    `ClassId` CHAR(36) NOT NULL,
    `StudentId` CHAR(36) NOT NULL,
    `Status` ENUM('ENROLLED', 'WAITLISTED', 'DROPPED', 'COMPLETED') NOT NULL DEFAULT 'ENROLLED',
    `EnrolledAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `DroppedAt` DATETIME(6) NULL,
    `CurrentGrade` DECIMAL(5, 2) NULL,
    `UpdatedAt` DATETIME(6) NOT NULL,

    INDEX `ClassEnrollments_StudentId_Status_idx`(`StudentId`, `Status`),
    UNIQUE INDEX `ClassEnrollments_ClassId_StudentId_key`(`ClassId`, `StudentId`),
    PRIMARY KEY (`Id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Courses` ADD CONSTRAINT `Courses_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Courses` ADD CONSTRAINT `Courses_InstructorId_fkey` FOREIGN KEY (`InstructorId`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Courses` ADD CONSTRAINT `Courses_CreatedById_fkey` FOREIGN KEY (`CreatedById`) REFERENCES `Users`(`Id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CoursePrerequisites` ADD CONSTRAINT `CoursePrerequisites_CourseId_fkey` FOREIGN KEY (`CourseId`) REFERENCES `Courses`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CoursePrerequisites` ADD CONSTRAINT `CoursePrerequisites_PrerequisiteCourseId_fkey` FOREIGN KEY (`PrerequisiteCourseId`) REFERENCES `Courses`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Modules` ADD CONSTRAINT `Modules_CourseId_fkey` FOREIGN KEY (`CourseId`) REFERENCES `Courses`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lessons` ADD CONSTRAINT `Lessons_ModuleId_fkey` FOREIGN KEY (`ModuleId`) REFERENCES `Modules`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Classes` ADD CONSTRAINT `Classes_OrganizationId_fkey` FOREIGN KEY (`OrganizationId`) REFERENCES `Organizations`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Classes` ADD CONSTRAINT `Classes_CourseId_fkey` FOREIGN KEY (`CourseId`) REFERENCES `Courses`(`Id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClassTeachers` ADD CONSTRAINT `ClassTeachers_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClassTeachers` ADD CONSTRAINT `ClassTeachers_TeacherId_fkey` FOREIGN KEY (`TeacherId`) REFERENCES `Users`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClassEnrollments` ADD CONSTRAINT `ClassEnrollments_ClassId_fkey` FOREIGN KEY (`ClassId`) REFERENCES `Classes`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClassEnrollments` ADD CONSTRAINT `ClassEnrollments_StudentId_fkey` FOREIGN KEY (`StudentId`) REFERENCES `Students`(`Id`) ON DELETE CASCADE ON UPDATE CASCADE;

