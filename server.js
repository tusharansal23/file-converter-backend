const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const { exec } = require('child_process');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const Poppler = require('pdf-poppler'); // ✅ NEW for PDF to JPG

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// Conversion route
app.post('/convert', upload.single('file'), async (req, res) => {
  const file = req.file;
  const targetFormat = req.body.targetFormat?.trim().toLowerCase();
  console.log("req= ", req.body);
  console.log(`Uploaded file: ${file.originalname}, Type: ${file.mimetype}`);
  console.log(`Requested target format: ${targetFormat}`);

  if (!file || !targetFormat) {
    return res.status(400).send('Missing file or target format');
  }

  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  const inputPath = file.path;
  const outputFilename = `converted-${Date.now()}.${targetFormat}`;
  const outputPath = path.join(__dirname, 'converted', outputFilename);

  try {
    const convertedDir = path.join(__dirname, 'converted');
    if (!fs.existsSync(convertedDir)) fs.mkdirSync(convertedDir);

    // DOCX to HTML
    if (ext === 'docx' && targetFormat === 'html') {
      const result = await mammoth.convertToHtml({ path: inputPath });
      fs.writeFileSync(outputPath, result.value);
      return res.download(outputPath, () => fs.unlinkSync(outputPath));
    }

    // Video conversion using ffmpeg
    else if (
      ['mp4', 'avi', 'mov', 'mkv'].includes(ext) &&
      ['mp4', 'avi', 'mov', 'mkv'].includes(targetFormat)
    ) {
      exec(`ffmpeg -i "${inputPath}" "${outputPath}"`, (error) => {
        if (error) return res.status(500).send('Video conversion failed');
        return res.download(outputPath, () => fs.unlinkSync(outputPath));
      });
    }

    // Image-to-Image conversion using sharp
    else if (
      ['jpg', 'jpeg', 'png', 'webp'].includes(ext) &&
      ['jpg', 'jpeg', 'png', 'webp'].includes(targetFormat)
    ) {
      await sharp(inputPath)[targetFormat]().toFile(outputPath);
      return res.download(outputPath, () => fs.unlinkSync(outputPath));
    }

    // Image to PDF conversion using pdf-lib
    else if (
      ['jpg', 'jpeg', 'png'].includes(ext) &&
      targetFormat === 'pdf'
    ) {
      const pdfDoc = await PDFDocument.create();
      const imageBytes = fs.readFileSync(inputPath);
      let image;

      if (ext === 'png') {
        image = await pdfDoc.embedPng(imageBytes);
      } else {
        image = await pdfDoc.embedJpg(imageBytes);
      }

      const { width, height } = image.scale(1);
      const page = pdfDoc.addPage([width, height]);
      page.drawImage(image, { x: 0, y: 0, width, height });

      const pdfBytes = await pdfDoc.save();
      fs.writeFileSync(outputPath, pdfBytes);
      return res.download(outputPath, () => fs.unlinkSync(outputPath));
    }

    // ✅ PDF to JPG using pdf-poppler
    else if (ext === 'pdf' && targetFormat === 'jpg') {
      const options = {
        format: 'jpeg',
        out_dir: convertedDir,
        out_prefix: `page-${Date.now()}`,
        page: null, // convert all pages
      };

      await Poppler.convert(inputPath, options);

      const outputFiles = fs.readdirSync(convertedDir).filter(f =>
        f.startsWith(options.out_prefix)
      );

      if (outputFiles.length === 0) {
        return res.status(500).send('No JPG generated from PDF');
      }

      const firstPageImage = path.join(convertedDir, outputFiles[0]);
      return res.download(firstPageImage, () => fs.unlinkSync(firstPageImage));
    }

    else {
      return res.status(400).send('Unsupported conversion type');
    }
  } catch (err) {
    console.error('Conversion error:', err);
    res.status(500).send('Conversion failed');
  } finally {
    fs.unlinkSync(inputPath);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
