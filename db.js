const mongoose = require("mongoose");
const {format} = require("date-fns");
mongoose.set("strictQuery", false);

var env = process.env.NODE_ENV || "development";
if (env === "development") {
  var config = require("./config")["development"];
} else if (env.trim() == "production") {
  var config = require("./config")["production"];
} else if (env.trim() == "colo") {
  var config = require("./config")["colo"];
}else if (env.trim() == "gcp") {
  var config = require("./config")["gcp"];
} else {
  var config = require("./config")["uat"];
}
const {
  database: { host, port, name, suffix },
} = config;

const {
  app: { appPort },
} = config;

const {
  reportConfig: { reportChunk, reportLocation },
} = config;

const {
  externalAPI: { cdsApi,apacheDrillApi },
} = config;

async function formatDatesInArrayOfObjects(arr,userTimeZone,userLanguageTag,userHourCycle) {
  const formattedArr = [];
  for (let i = 0; i < arr.length; i++) {
    const obj = arr[i];
    for (let key in obj) {
      const iso8601regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z?$/;
      if (iso8601regex.test(obj[key]) || obj[key] instanceof Date) {
        const dateObject = new Date(obj[key]);
        const timeZone = userTimeZone ? userTimeZone : "Asia/Kolkata";
        const languageTag = userLanguageTag || Intl.DateTimeFormat(undefined, { timeZone }).resolvedOptions().locale;
        const hourCycle = userHourCycle || Intl.DateTimeFormat(languageTag).resolvedOptions().hourCycle || 'h23';
        const options = {
          timeZone: timeZone,
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: hourCycle
        };
        obj[key] = dateObject.toLocaleString(languageTag, options).replace(/[/]/g, '-');
      }
    }
    formattedArr.push(obj);
  }
  return formattedArr;
}

const connectionString = `mongodb://${host}:${port}/${name}${suffix}`;
let mongDb;
(async () => {
  try {
    mongoose.connect(connectionString, { useNewUrlParser: true });
    mongDb = mongoose.connection;
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
})();
module.exports = {
  name,
  mongDb,
  appPort,
  connectionString,
  reportChunk,
  reportLocation,
  cdsApi,
  apacheDrillApi,
  formatDatesInArrayOfObjects
};
