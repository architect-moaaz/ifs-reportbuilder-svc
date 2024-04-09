const express = require("express");
const app = express();
const helmet = require("helmet");
const cors = require("cors");
const { appPort } = require("./db");
const { job, deleteReportJob } = require("./reportQueueJob");
app.use(express.json());
app.use(helmet());
app.use(cors());

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

app.use((req, res, next) => {
  req.body.token = {};
  req.body.token["groups"] = !req.headers.group
    ? []
    : req.headers.group.split(",");
  req.body.token["username"] = req.headers.user;
  req.headers.workspacename = req.headers.workspace;
  if (!req.headers.workspace) {
    return res.status(400).json({ message: "Workspace missing" });
  }
  next();
});

const processRouter = require("./routes/processRoutes");
app.use("/reportBuilder", processRouter);
job.start();
//deleteReportJob.start();

app.listen(appPort, () => console.log(`And server started on ${appPort}`));
