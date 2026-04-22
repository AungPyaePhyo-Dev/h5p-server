-- CreateTable
CREATE TABLE "h5p_content" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mainLibrary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "h5p_content_pkey" PRIMARY KEY ("id")
);
