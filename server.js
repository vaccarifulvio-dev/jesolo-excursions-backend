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

// 5. Configurazione Trasportatore Email Aruba SMTP (Ottimizzata per evitare Connection Timeout)
const transporter = nodemailer.createTransport({
    host: 'smtps.aruba.it',
    port: 587,
    secure: false, // false per porta 587 (usa STARTTLS)
    auth: {
        user: 'info@jesoloexcursions.eu',
        pass: process.env.ARUBA_MAIL_PASSWORD
    },
    tls: {
        rejectUnauthorized: false
    },
    connectionTimeout: 10000, // 10 secondi per stabilire la connessione
    greetingTimeout: 10000,   // 10 secondi per la risposta di benvenuto SMTP
    socketTimeout: 15000      // 15 secondi di inattività max prima di chiudere il socket
});

// 📋 LISTINO PREZZI, GIORNI E MESI LATO SERVER
// allowedDays: 0=Dom, 1=Lun, 2=Mar, 3=Mer, 4=Gio, 5=Ven, 6=Sab
// allowedMonths: 1=Gen, 2=Feb ... 5=Maggio ... 10=Ottobre
const EXCURSIONS_DATA = {
    venice: { 
        name: "Venezia & Isole", 
        adult: 35, 
        child: 20, 
        allowedDays: [3], // Solo Mercoledì
        allowedMonths: [5, 6, 7, 8, 9, 10] // Maggio - Ottobre
    },
    lagoon: { 
        name: "Tour della Laguna al Tramonto", 
        adult: 25, 
        child: 15, 
        allowedDays: [1, 5], // Lunedì e Venerdì
        allowedMonths: [5, 6, 7, 8, 9, 10] // Maggio - Ottobre
    },
    kayak: { 
        name: "Escursione Kayak Sile", 
        adult: 40, 
        child: 25, 
        allowedDays: [2, 4, 6], // Martedì, Giovedì e Sabato
        allowedMonths: [6, 7, 8, 9] // Giugno - Settembre
    },
    cortina: { 
        name: "Cortina e Dolomiti", 
        adult: 1, 
        child: 1, 
        allowedDays: [2], // Solo Martedì
        allowedMonths: [5, 6, 7, 8, 9, 10] // Maggio - Ottobre
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

        // 3. Controllo sicurezza data (Giorno della settimana e Mese)
        const selectedDate = new Date(date);
        const dayOfWeek = selectedDate.getUTCDay();
        const month = selectedDate.getUTCMonth() + 1; // 1-12

        if (excursionInfo.allowedMonths && !excursionInfo.allowedMonths.includes(month)) {
            return res.status(400).json({ error: 'L\'escursione non è disponibile nel mese selezionato.' });
        }

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
