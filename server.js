const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const { Resend } = require('resend');

// 1. Inizializza l'app Express
const app = express();

// 2. Abilita CORS e la lettura dei dati JSON
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// 3. Serve i file statici dalla cartella principale
app.use(express.static(path.join(__dirname)));

// 4. Inizializza Stripe e Resend tramite le variabili d'ambiente di Render
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// 📋 LISTINO PREZZI, GIORNI E MESI LATO SERVER
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
        const { excursion, adults, children, email, fullname, phone, notes, date } = req.body;

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
                cliente: fullname || 'Non specificato',
                escursione: excursionInfo.name,
                data_escursione: date,
                adulti: numAdults,
                bambini: numChildren,
                email_cliente: email,
                telefono_cliente: phone || 'Non specificato',
                note: notes || 'Nessuna nota'
            }
        });

        // 6. Invio Email di conferma via Resend API (HTTP HTTPS - Porta 443)
        // Nota: Resend di default permette l'invio da 'onboarding@resend.dev' durante i test.
        // Quando verificherai il tuo dominio jesoloexcursions.eu su Resend, potrai usare 'info@jesoloexcursions.eu'
        const emailFrom = 'Jesolo Excursions <info@jesoloexcursions.eu>';

        resend.emails.send({
            from: emailFrom,
            to: [email, 'info@jesoloexcursions.eu'],
            subject: `Conferma Prenotazione - ${excursionInfo.name}`,
            html: `
                <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; padding: 20px; border-radius: 8px;">
                    <h2 style="color: #0056b3; text-align: center;">Conferma di Prenotazione</h2>
                    <p>Gentile <strong>${fullname || 'cliente'}</strong>,</p>
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
                        <td style="padding: 10px; border: 1px solid #ddd;"><strong>Nome e Cognome:</strong></td>
                        <td style="padding: 10px; border: 1px solid #ddd;">${fullname || 'Non specificato'}</td>
                        </tr>
                        <tr>
                        <td style="padding: 10px; border: 1px solid #ddd;"><strong>Telefono:</strong></td>
                         <td style="padding: 10px; border: 1px solid #ddd;">${phone || 'Non specificato'}</td>
                        </tr>
                        <tr>
                        <td style="padding: 10px; border: 1px solid #ddd;"><strong>Note:</strong></td>
                        <td style="padding: 10px; border: 1px solid #ddd;">${notes || 'Nessuna nota'}</td>
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
        }).then(response => {
            console.log("Email inviata con successo via Resend:", response);
        }).catch(err => {
            console.error("Errore invio email via Resend:", err);
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
