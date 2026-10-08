const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');

app.use(cors()); // <--- Dev'esserci questo (abilita le chiamate esterne)
app.use(express.json()); // Permette di leggere i dati JSON inviati da index.html

// ⚠️ INSERISCI QUI LA TUA CHIAVE SEGRETA DI STRIPE (sk_test_... oppure sk_live_...)
const stripe = require('stripe')('process.env.STRIPE_SECRET_KEY');

const app = express();

// Serve i file statici (index.html, css, immagini) dalla cartella attuale
app.use(express.static(path.join(__dirname)));
app.use(bodyParser.json());

// 📋 LISTINO PREZZI E GIORNI LATO SERVER (Per sicurezza)
// 0=Domenica, 1=Lunedì, 2=Martedì, 3=Mercoledì, 4=Giovedì, 5=Venerdì, 6=Sabato
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
    }
};

// 💳 API PER CREARE IL PAGAMENTO SU STRIPE
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

        // 4. Calcolo del totale in EURO e conversione in CENTESIMI (Stripe ragiona in centesimi)
        const totalEuro = (excursionInfo.adult * numAdults) + (excursionInfo.child * numChildren);
        const totalCents = totalEuro * 100;

        // 5. Creazione della transazione (Payment Intent) su Stripe
        const paymentIntent = await stripe.paymentIntents.create({
            amount: totalCents,
            currency: 'eur',
            receipt_email: email,
            description: `Prenotazione: ${excursionInfo.name} per il ${date}`,
            // Salviamo i dettagli della prenotazione nei dati di Stripe (visibili nella dashboard)
            metadata: {
                escursione: excursionInfo.name,
                data_escursione: date,
                adulti: numAdults,
                bambini: numChildren,
                email_cliente: email
            }
        });

        // Invia il token clientSecret al front-end per confermare il pagamento
        res.json({ clientSecret: paymentIntent.client_secret });

    } catch (e) {
        console.error("Errore server Stripe:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// Avvio del server sulla porta 3000 (o quella assegnata dal provider hosting)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server Jesolo Excursions attivo sulla porta ${PORT}!`));
