const { parentPort } = require("worker_threads");
const MongoClient = require("mongodb").MongoClient;
const { name, connectionString, reportChunk,formatDatesInArrayOfObjects } = require("../db");

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

var {
  generateMultipleModelReport,
  getReportFromApacheDrill,
  generateProcessReport,
  exportToPdf,
  exportToCsv,
  exportToExcel,
} = require("./reportDownloadUtils");
const {format} = require("date-fns");

parentPort.on("message", async ({ reportQueue }) => {
  await generatedReport(reportQueue);
});

async function generatedReport(reportQueue) {
  const reportMetaData = await db.collection("metadatas").findOne({
    workSpaceName: reportQueue.workspace,
    reportName: reportQueue.reportName,
  });
  try {
    var allData = [];
    var chunk = reportChunk ? reportChunk : 5000,
      skip = 0;
    while (true) {
      skip++;
      if (reportQueue.reportType == "singleModel") {
        var data = await generateProcessReport(
          reportMetaData.projection,
          reportMetaData.filter,
          reportMetaData.tables,
          reportMetaData.sort,
          reportMetaData.dbName,
          skip,
          chunk,
          false
        );
      } else {
        // var data = await generateMultipleModelReport(
        //   skip,
        //   chunk,
        //   reportMetaData,
        //   false
        // );
        var data = await getReportFromApacheDrill(
          skip,
          chunk,
          reportMetaData
        );
      }
      if (data.length == 0) {
        break;
      }
      allData = allData.concat(data);
    }
    allData = await formatDatesInArrayOfObjects(allData,reportQueue.timeZone,reportQueue.languageTag,reportQueue.hourCycle);
    if (allData.length > 0) {
      if (reportQueue.fileType == "pdf") {
        var fileInfoFromCds = await exportToPdf(allData, reportQueue.reportId,reportQueue.ttl,reportQueue.reportName);
      } else if (
        reportQueue.fileType == "excel" ||
        reportQueue.fileType == "xlsx"
      ) {
        var fileInfoFromCds = await exportToExcel(
          allData,
          reportQueue.reportId,reportQueue.ttl,reportQueue.reportName
        );
      } else {
        var fileInfoFromCds = await exportToCsv(allData, reportQueue.reportId,reportQueue.ttl);
      }
      parentPort.postMessage(fileInfoFromCds);
    } else {
      parentPort.postMessage("nodata");
    }
  } catch (err) {
    console.error(err);
    parentPort.postMessage("nodata");
  }
}

