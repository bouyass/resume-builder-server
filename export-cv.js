import { storeResume } from './storeResume.js'; // le fichier du dessus
import nodemailer from 'nodemailer';
import multer from 'multer';
import express from 'express';
import puppeteer from 'puppeteer';
import bodyParser from 'body-parser';
import cors from 'cors'
import stripe from 'stripe'
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv'

dotenv.config()

console.log(process.env.STRIPE_SECRET_KEY)
const _stripe = stripe(process.env.STRIPE_SECRET_KEY);

const RESUME_DIR = path.join(process.cwd(), 'resumes');
const META_DIR = path.join(process.cwd(), 'metadata');


const app = express();
const upload = multer();
app.use(cors());

app.use(bodyParser.text({ type: 'text/html' }));

// Webhook endpoint MUST be before other body parsers
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = _stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_SECRET_KEY);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('Payment succeeded:', paymentIntent.id);
      // You can add additional logic here (e.g., update database, send email)
      break;
    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.log('Payment failed:', failedPayment.id);
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

// General middleware (after webhook)
app.use(bodyParser.json()); // JSON parsing for most endpoints
app.use(bodyParser.text({ type: 'text/html' })); // For HTML content

const PORT = 3001;

// Create payment intent endpoint
app.post('/create-payment-intent', async (req, res) => {
  try {
    
    const { amount, currency = 'usd', description = 'PDF Generation Service' } = req.body || {};
    
    if (!amount) {
      console.error('Missing amount in request body:', req.body);
      return res.status(400).json({ error: 'Amount is required' });
    }

    const paymentIntent = await _stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency,
      description: description,
      automatic_payment_methods: {
        enabled: true,
      },
    });


    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify payment status endpoint
app.post('/verify-payment', async (req, res) => {
  try {

    const { paymentIntentId } = req.body || {};
    
    if (!paymentIntentId) {
      console.error('Missing paymentIntentId in request body:', req.body);
      return res.status(400).json({ error: 'Payment intent ID is required' });
    }

    const paymentIntent = await _stripe.paymentIntents.retrieve(paymentIntentId);
    
    
    if (paymentIntent.status === 'succeeded') {
      res.json({ 
        success: true, 
        status: paymentIntent.status,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency
      });
    } else {
      res.json({ 
        success: false, 
        status: paymentIntent.status 
      });
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ error: error.message });
  }
});

// Webhook endpoint for Stripe events (must be before other middleware)
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = _stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_SECRET_KEY);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('Payment succeeded:', paymentIntent.id);
      // You can add additional logic here (e.g., update database, send email)
      break;
    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.log('Payment failed:', failedPayment.id);
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

app.post('/generate-pdf', async (req, res) => {
  const html = req.body;
  if (!html) {
    return res.status(400).send('No HTML provided');
  }
  let browser;
  try {
    browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      omitBackground: false,
      outline: false,
      landscape: false,
      preferCSSPageSize: false,
      margin: { top: '0', bottom: '0', left: '0', right: '0' }
    });
    await browser.close();
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="cv.pdf"',
    });
    res.send(pdfBuffer);
  } catch (err) {
    if (browser) await browser.close();
    res.status(500).send('PDF generation failed: ' + err.message);
  }
});

app.post('/send-cv', upload.single('cv'), async (req, res) => {
  console.log('sending cv via email ...')
  try {
    const { email } = req.body;
    const file = req.file;

    if (!email || !file) {
      return res.status(400).json({ error: 'Email et fichier requis.' });
    }


    // stocker le cv 
    const guid = storeResume(email, file.buffer);
    const downloadUrl = `http://localhost:3001/cv-download/${guid}`;
    // Config du transport (ici exemple Gmail)
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'lyes.makhloufi.0694@gmail.com',
        pass: 'hwrj lmkf nbix qijy',
      },
    });

    // Préparer l’email
    const mailOptions = {
      from: '"Mon App CV" lyes.makhloufi.0694@gmail.com',
      to: email,
      subject: 'Votre CV généré',
      text: `Votre CV est prêt ! Téléchargez-le ici (valable 7 jours) : ${downloadUrl}`,
      attachments: [
        {
          filename: 'mon-cv.pdf',
          content: file.buffer, // buffer reçu via multer
        },
      ],
    };

    // Envoi
    await transporter.sendMail(mailOptions);

    res.json({ success: true, message: 'Lien envoyé par email.', downloadUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l’envoi de l’email.' });
  }
});


app.get('/cv-download/:guid', (req, res) => {
  const { guid } = req.params;
  const filePath = path.join('./resumes', `${guid}.pdf`);
  const metaPath = path.join('./metadata', `${guid}.json`);

  if (!fs.existsSync(filePath) || !fs.existsSync(metaPath)) {
    return res.status(404).send('Lien invalide ou fichier supprimé');
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  if (Date.now() > meta.expiresAt) {
    return res.status(410).send('Lien expiré');
  }

  res.download(filePath, 'cv.pdf');
});

app.listen(PORT, () => {
  console.log(`PDF generator server running at http://localhost:${PORT}`);


  setInterval(() => {
    const files = fs.readdirSync(META_DIR);
    for (const file of files) {
      const meta = JSON.parse(fs.readFileSync(path.join(META_DIR, file), 'utf-8'));
      if (Date.now() > meta.expiresAt) {
        const guid = file.replace('.json', '');
        fs.unlinkSync(path.join(RESUME_DIR, `${guid}.pdf`));
        fs.unlinkSync(path.join(META_DIR, file));
      }
    }
  }, 24 * 3600 * 1000);

});