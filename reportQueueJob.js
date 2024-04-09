const cron = require("cron");
const fs = require("fs").promises;
const path = require("path");
const { name,connectionString, reportLocation, cdsApi } = require("./db");
const { Worker } = require("worker_threads");
const crypto = require("crypto");
const MongoClient = require("mongodb").MongoClient;

let db;
(async () => {
  try {
    const client = new MongoClient(connectionString, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    await client.connect();
    db = client.db(name);
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
})();

const pool = [];
for (let i = 0; i < 4; i++) {
  const worker = new Worker("./utils/reportWorkerThreads.js");
  worker.isIdle = true;
  worker.number = i;
  pool.push(worker);
}
async function createFileHash(fileName) {
  const secretKey = process.env.REPORT_FILE_SECRET;
  const hash = crypto.createHash("sha256");
  hash.update(fileName + secretKey);
  return hash.digest("hex");
}

const job = new cron.CronJob("*/50 * * * * *", async () => {
  try {
    const queuedRequest = await getNextQueuedReport();
    if (queuedRequest) {
      const worker = pool.find((worker) => worker.isIdle);
      if (!worker) {
        console.log("All the report downloader worker threads are busy.");
      } else {
        console.log(
          `Thread ${worker.number} generating the report with reportId ${queuedRequest.reportId}`
        );
        worker.isIdle = false;
        await db.collection("reportqueues").updateOne(
          {
            reportId: queuedRequest.reportId,
          },
          {
            $set: {
              status: "InProgress",
              reportGenerationStartTime: new Date(),
            },
          }
        );
        worker.postMessage({ reportQueue: queuedRequest });
        worker.once("message", async (message) => {
          // console.log(message);
          if (!message) {
            var status = "failed";
            var file = null;
            var remarks = "Internal server error";
            var fileUrl = `File generation failed.`;
          } else if (message == "nodata") {
            var status = "failed";
            var file = null;
            var remarks = "The report has no data";
            var fileUrl = `File generation failed.`;
          } else {
            var status = "Completed";
            var file = message.file;
            var remarks = "File generated successfully";
            const fileHash = await createFileHash(file.filename);
            var fileUrl = `${cdsApi}/reportFiles/file/${file.filename}?hash=${fileHash}`;
          }
          worker.isIdle = true;
          await db.collection("reportqueues").updateOne(
            {
              reportId: queuedRequest.reportId,
            },
            {
              $set: {
                status: status,
                reportGenerationEndTime: new Date(),
                fileInfo: file,
                fileURL: fileUrl,
                remarks: remarks,
              },
            }
          );
        });
      }
    }
  } catch (err) {
    console.error(err);
  }
});

const deleteReportJob = new cron.CronJob("0 0 * * *", async () => {
  await checkreportExpiry();
});

async function checkreportExpiry() {
  const reportQueues = await db.collection("reportqueues").find().toArray();
  for (let i = 0; i < reportQueues.length; i++) {
    const report = reportQueues[i];
    const targetDate = report.queuedTime;
    const now = new Date();
    const difference = now.getTime() - targetDate.getTime();
    if (difference > 3 * 24 * 60 * 60 * 1000) {
      var documentsPath = path.normalize(
        `${process.env.HOME.trim()}/${reportLocation.trim()}/${report.reportId}`
      );
      try {
        await deleteFolderRecursive(documentsPath);
        const query = {
          reportId: report.reportId,
        };
        await db.collection("reportqueues").deleteOne(query);
      } catch (err) {
        console.err(err);
      }
    } else {
      console.log(
        `The difference is less than or equal to 3 days for the report with reportId ${report.reportId}.`
      );
    }
  }
}

async function deleteFolderRecursive(folderPath) {
  try {
    const stats = await fs.stat(folderPath);
    if (stats.isDirectory()) {
      const files = await fs.readdir(folderPath);
      for (const file of files) {
        const curPath = path.join(folderPath, file);
        await deleteFolderRecursive(curPath);
      }
      await fs.rmdir(folderPath);
      console.log(`Deleted folder: ${folderPath}`);
    } else {
      await fs.unlink(folderPath);
      console.log(`Deleted file: ${folderPath}`);
    }
  } catch (err) {
    console.error(`Error deleting ${folderPath}:`, err);
  }
}

async function getNextQueuedReport() {
  var options = {
    allowDiskUse: true,
  };
  let pipleLine = [
    {
      $lookup: {
        from: "reportqueues",
        let: { workspace: "$workspace" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$status", "Queued"] },
                  { $ne: ["$$workspace", "$workspace"] },
                  { $ne: ["$status", "InProgress"] },
                ],
              },
            },
          },
        ],
        as: "reports",
      },
    },
    {
      $match: {
        status: "Queued",
      },
    },
    {
      $sort: {
        queuedTime: 1,
      },
    },
    {
      $project: {
        reportId: 1,
        reportName: 1,
        workspace: 1,
        ttl: 1,
        queuedTime: 1,
        timeZone: 1,
        languageTag: 1,
        hourCycle: 1,
        reportGenerationStartTime: 1,
        reportGenerationEndTime: 1,
        status: 1,
        reportType: 1,
        fileType: 1,
        files: 1,
      },
    },
  ];
  // try {
  //   const cursor = db
  //     .collection("reportqueues")
  //     .aggregate(pipleLine, options)
  //     .limit(1);
  //   const result = await cursor.toArray();
  //   return result[0];
  // } catch (error) {
  //   console.error("Error occurred while retrieving next queued report:", error);
  // }

  try {
    const result = await db
      .collection("reportqueues")
      .aggregate(pipleLine)
      .limit(1)
      .toArray();
    return result[0];
  } catch (error) {
    console.error("Error occurred while retrieving next queued report:", error);
    throw error;
  }
}

module.exports = { job, deleteReportJob };
