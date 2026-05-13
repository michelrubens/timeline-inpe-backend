const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const cors = require("cors");
require("dotenv").config({
  quiet: true,
  path: path.resolve(__dirname, "..", ".env"),
}); // Carrega a URI do .env (segurança)

const app = express();
const PORT = process.env.PORT;

// Middleware
app.use(cors());
app.use(express.json());

app.use(
  "/imagens",
  express.static(path.join(__dirname, "..", "public/imagens")),
);

// 1. Configura o Mongoose (Conexão com o MongoDB)
const mongoURI = process.env.MONGO_URI;
mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ Conectado ao MongoDB com sucesso!"))
  .catch((err) => console.error("❌ Erro de conexão com o MongoDB:", err));

const imagemSchema = new mongoose.Schema({
  url: String,
  legenda: String,
});

const contextoSchema = new mongoose.Schema({
  topicos: [String],
  imagens: [imagemSchema], // <- era [String], agora é [imagemSchema]
});

// 2. Define o Schema e o Model (O "contrato" dos dados)
const anoSchema = new mongoose.Schema({
  ano: { type: Number, required: true, unique: true },
  contextos: {
    inpe: contextoSchema,
    brasil: contextoSchema,
    mundo: contextoSchema,
  },
});

const Ano = mongoose.model("Ano", anoSchema);

// 3. Define as Rotas da API
// Rota para buscar todos os anos, ordenados
app.get("/api/timeline", async (req, res) => {
  try {
    const pagina = Math.max(1, parseInt(req.query.pagina) || 1);
    const limite = Math.min(20, parseInt(req.query.limite) || 5);
    const skip = (pagina - 1) * limite;

    const [dados, total] = await Promise.all([
      Ano.find().sort({ ano: 1 }).skip(skip).limit(limite),
      Ano.countDocuments(),
    ]);

    res.json({
      dados,
      pagina,
      limite,
      total,
      temMais: skip + dados.length < total,
    });
  } catch (err) {
    res.status(500).json({ message: "Erro ao buscar os anos.", error: err });
  }
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
