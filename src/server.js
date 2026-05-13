const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const cors = require("cors");

const multer = require("multer");
const fs = require("fs");

require("dotenv").config({
  quiet: true,
  path: path.resolve(__dirname, "..", ".env"),
}); // Carrega a URI do .env (segurança)

const app = express();
const PORT = process.env.PORT;

// Middleware
app.use(cors());
app.use(express.json());

const pastaImagens = path.join(__dirname, "..", "public", "imagens");
app.use("/imagens", express.static(pastaImagens));

// 1. Configura o Mongoose (Conexão com o MongoDB)
const mongoURI = process.env.MONGO_URI;
mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ Conectado ao MongoDB com sucesso!"))
  .catch((err) => console.error("❌ Erro de conexão com o MongoDB:", err));

const imagemSchema = new mongoose.Schema({
  url: String,
  legenda: String,
  fonte: {
    texto: String, // ex: "NASA"
    link: String, // ex: "https://www.nasa.gov"
  },
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

    // Normaliza os dados antes de enviar ao frontend
    const dadosNormalizados = dados.map((doc) => {
      const d = doc.toObject();
      ["inpe", "brasil", "mundo"].forEach((ctx) => {
        // Garante que o contexto existe mesmo que não tenha sido inserido
        if (!d.contextos) d.contextos = {};
        if (!d.contextos[ctx]) d.contextos[ctx] = { topicos: [], imagens: [] };

        d.contextos[ctx].topicos = (d.contextos[ctx].topicos || []).map((t) =>
          typeof t === "string" ? t : String(t),
        );
        d.contextos[ctx].imagens = (d.contextos[ctx].imagens || []).map(
          (img) => ({
            url: img.url || "",
            legenda: img.legenda || "",
            fonte: {
              texto: img.fonte?.texto || "",
              link: img.fonte?.link || "",
            },
          }),
        );
      });
      return d;
    });

    res.json({
      dados: dadosNormalizados,
      pagina,
      limite,
      total,
      temMais: skip + dados.length < total,
    });
  } catch (err) {
    res.status(500).json({ message: "Erro ao buscar os anos.", error: err });
  }
});

// Multer — salva os arquivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { ano, contexto } = req.body;
    const dir = path.join(pastaImagens, String(ano), contexto);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage });

// Rota de inserção de novo ano com imagens
app.post(
  "/api/timeline",
  apenasLocal,
  autenticarAdmin,
  upload.array("imagens"),
  async (req, res) => {
    try {
      const { ano, contexto, topicos, legenda, fonteTexto, fonteLink } =
        req.body;

      const topicosList = Array.isArray(topicos) ? topicos : [topicos];

      const imagens = (req.files || []).map((file, i) => ({
        url: `/imagens/${ano}/${contexto}/${file.originalname}`,
        legenda: Array.isArray(legenda) ? legenda[i] : legenda,
        fonte: {
          texto: Array.isArray(fonteTexto) ? fonteTexto[i] : fonteTexto,
          link: Array.isArray(fonteLink) ? fonteLink[i] : fonteLink,
        },
      }));

      // Upsert — cria o documento se não existir, ou atualiza o contexto
      await Ano.findOneAndUpdate(
        { ano: Number(ano) },
        {
          $set: { [`contextos.${contexto}.topicos`]: topicosList },
          $push: { [`contextos.${contexto}.imagens`]: { $each: imagens } },
        },
        { upsert: true, new: true },
      );

      res
        .status(201)
        .json({ mensagem: "Ano inserido/atualizado com sucesso." });
    } catch (err) {
      res.status(500).json({ mensagem: "Erro ao inserir ano.", error: err });
    }
  },
);

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

// Middleware para autenticação

function autenticarAdmin(req, res, next) {
  const chave = req.headers["x-api-key"];
  if (!chave || chave !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ mensagem: "Não autorizado." });
  }
  next();
}

function apenasLocal(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const permitidos = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

  if (!permitidos.includes(ip)) {
    return res.status(403).json({ mensagem: "Acesso negado." });
  }
  next();
}
