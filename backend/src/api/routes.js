const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// We would normally import queueManager here to send tasks to Bull
// const queueManager = require('../workers/queue-manager');

const router = express.Router();

// Setup Multer for file uploads
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({ storage });

/**
 * POST /api/documents/upload
 * Endpoint to handle document uploads for ingestion.
 */
router.post('/documents/upload', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No document file provided.' });
        }

        const fileInfo = {
            filename: req.file.filename,
            originalname: req.file.originalname,
            path: req.file.path,
            mimetype: req.file.mimetype,
            size: req.file.size
        };

        console.log('File uploaded:', fileInfo);

        // Here we would typically enqueue a job for the workers to process
        // For example:
        // await queueManager.addIngestionJob(fileInfo);

        res.status(202).json({
            message: 'Document uploaded successfully and queued for processing.',
            file: {
                id: fileInfo.filename,
                name: fileInfo.originalname
            },
            status: 'processing'
        });
    } catch (error) {
        console.error('Error handling file upload:', error);
        res.status(500).json({ error: 'Internal server error during upload.' });
    }
});

module.exports = router;
