const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const nodemailer = require('nodemailer');

// 1. Inizializza l'app Express
const app = express();

// 2. Abilita CORS e la lettura dei dati JSON
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// 3. Serve i file statici dalla cartella principale
app.use(express.static(path.join(__dirname)));

// 4. Inizializza Stripe leggendo la chiave dalle Environment Variables di Render
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// 5. Configurazione Trasportatore Email Aruba SMTP
const transporter = nodemailer.createTransport({
    host: 'smtps.aruba.it',
    port: 465,
    secure: true, // SSL/TLS
    auth: {
        user: 'info@jesoloexcursions.eu',
        pass: process.env.ARUBA_MAIL_PASSWORD
    }
});

// 📋 LISTINO PREZZI E GIORNI LATO SERVER
const EXCURSIONS_DATA = {
    venice: { 
        name: "Venezia & Isole", 
        adult: 35, 
        child: 20, 
        allowedDays: [3] // Solo Mercoledì
    },
    lagoon: { 
        name: "Tour della Laguna al Tramonto", 
        adult: 25, 
        child: 15, 
        allowedDays: [1, 5] // Lunedì e Venerdì
    },
    kayak: { 
        name: "Escursione Kayak Sile", 
        adult: 40, 
        child: 25, 
        allowedDays: [2, 4, 6] // Martedì, Giovedì e Sabato
    },
    cortina: { 
        name: "Cortina e Dolomiti", 
        adult: 1, 
        child: 1, 
        allowedDays: [2] // Solo Martedì
    }
};

// 💳 API PER CREARE IL PAGAMENTO SU STRIPE E INVIARE EMAIL
app.post('/create-payment-intent', async (req, res) => {
    try {
        const { excursion, adults, children, email, date } = req.body;

        // 1. Verifica che l'escursione esista
        const excursionInfo = EXCURSIONS_DATA[excursion];
        if (!excursionInfo) {
            return res.status(400).json({ error: 'Escursione selezionata non valida.' });
        }

        const numAdults = parseInt(adults) || 0;
        const numChildren = parseInt(children) || 0;

        // 2. Verifica che ci sia almeno 1 adulto
        if (numAdults < 1) {
            return res.status(400).json({ error: 'È necessario selezionare almeno un adulto.' });
        }

        // 3. Controllo sicurezza giorno della settimana
        const selectedDate = new Date(date);
        const dayOfWeek = selectedDate.getUTCDay();
        if (!excursionInfo.allowedDays.includes(dayOfWeek)) {
            return res.status(400).json({ error: 'L\'escursione non è disponibile nella data selezionata.' });
        }

        // 4. Calcolo del totale in EURO e conversione in CENTESIMI
        const totalEuro = (excursionInfo.adult * numAdults) + (excursionInfo.child * numChildren);
        const totalCents = totalEuro * 100;

        // 5. Creazione della transazione (Payment Intent) su Stripe
        const paymentIntent = await stripe.paymentIntents.create({
            amount: totalCents,
            currency: 'eur',
            receipt_email: email,
            description: `Prenotazione: ${excursionInfo.name} per il ${date}`,
            metadata: {
                escursione: excursionInfo.name,
                data_escursione: date,
                adulti: numAdults,
                bambini: numChildren,
                email_cliente: email
            }
        });

        // 6. Invio Email di conferma via Aruba SMTP
        const mailOptions = {
            from: '"Jesolo Excursions" <info@jesoloexcursions.eu>',
            to: `${email}, info@jesoloexcursions.eu`, // Invia una copia anche a te!
            subject: `Conferma Prenotazione - ${excursionInfo.name}`,
            html: `
                <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px;">
                    <h2 style="color: #0056b3; text-align: center;">Conferma di Prenotazione</h2>
                    <p>Gentile cliente,</p>
                    <p>Grazie per aver prenotato con <strong>Jesolo Excursions</strong>! Di seguito trovi i dettagli della tua prenotazione:</p>
                    
                    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                        <tr style="background-color: #f8f9fa;">
                            <td style="padding: 10px; border: 1px solid #ddd;"><strong>Escursione:</strong></td>
                            <td style="padding: 10px; border: 1px solid #ddd;">${excursionInfo.name}</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px; border: 1px solid #ddd;"><strong>Data:</strong></td>
                            <td style="padding: 10px; border: 1px solid #ddd;">${date}</td>
                        </tr>
                        <tr style="background-color: #f8f9fa;">
                            <td style="padding: 10px; border: 1px solid #ddd;"><strong>Partecipanti:</strong></td>
                            <td style="padding: 10px; border: 1px solid #ddd;">${numAdults} Adulti, ${numChildren} Bambini</td>
                        </tr>
                        <tr>
                            <td style="padding: 10px; border: 1px solid #ddd;"><strong>Totale Pagato:</strong></td>
                            <td style="padding: 10px; border: 1px solid #ddd;"><strong>€${totalEuro.toFixed(2)}</strong></td>
                        </tr>
                    </table>

                    <p>Ti preghiamo di presentarti al punto di ritrovo 15 minuti prima dell'orario di partenza.</p>
                    <p>Per qualsiasi informazione puoi rispondere direttamente a questa email.</p>
                    <hr style="border: none; border-top: 1px solid #ccc; margin: 20px 0;" />
                    <p style="font-size: 12px; color: #777; text-align: center;">Jesolo Excursions - info@jesoloexcursions.eu</p>
                </div>
            `
        };

        // Invio asincrono dell'email
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error("Errore nell'invio dell'email di conferma:", error);
            } else {
                console.log("Email di conferma inviata con successo:", info.response);
            }
        });

        // Invia il token clientSecret al front-end
        res.json({ clientSecret: paymentIntent.client_secret });

    } catch (e) {
        console.error("Errore server Stripe:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// Avvio del server sulla porta dinamica di Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server Jesolo Excursions attivo sulla porta ${PORT}!`);
});
