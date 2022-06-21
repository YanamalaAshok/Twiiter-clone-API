const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server running at http://localhost:3000/");
    });
  } catch (error) {
    process.exit(1);
    console.log(`DB Error: ${error.message}`);
  }
};

initializeDBAndServer();

//API1

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const getUserDetails = `
        SELECT 
            *
        FROM 
            user 
        WHERE 
            username = '${username}';`;
  const dbUser = await db.get(getUserDetails);
  if (dbUser === undefined) {
    if (password.length >= 6) {
      const createUserQuery = `
            INSERT INTO 
                user (username, password, name, gender)
            VALUES 
                ('${username}', '${hashedPassword}', '${name}', '${gender}');`;
      await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//API2

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `
        SELECT 
            *
        FROM 
            user 
        WHERE 
            username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "MY_SECRET_CODE");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//Authentication with JWT Token

const authenticateToken = (request, response, next) => {
  let jwtToken = "";
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_CODE", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

//API3

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  let { username } = request;
  const getLatestTweets = `
    SELECT 
        user.username,
        tweet.tweet,
        tweet.date_time as dateTime
    FROM 
        user INNER JOIN tweet ON user.user_id = tweet.user_id 
    WHERE
        tweet.user_id IN 
        (SELECT 
            follower.following_user_id
        FROM 
            user INNER JOIN follower ON user.user_id = follower.follower_user_id
        WHERE 
            username = '${username}')
    ORDER BY 
        dateTime DESC
    LIMIT 4;`;
  const latestTweets = await db.all(getLatestTweets);
  response.send(latestTweets);
});

//API4

app.get("/user/following/", authenticateToken, async (request, response) => {
  let { username } = request;
  const userFollows = `
        SELECT 
            name 
        FROM 
            user 
        WHERE
            user_id IN 
                (SELECT 
                    follower.following_user_id
                FROM 
                    user INNER JOIN follower ON user.user_id = follower.follower_user_id
                WHERE 
                    username = '${username}')`;
  const following = await db.all(userFollows);
  response.send(following);
});

//API5

app.get("/user/followers/", authenticateToken, async (request, response) => {
  let { username } = request;
  const userFollowers = `
    SELECT 
        user.name
    FROM 
        user INNER JOIN follower ON user.user_id = follower.follower_user_id
    WHERE
        following_user_id = 
            (SELECT 
                user_id 
            FROM 
                user 
            WHERE
                username = '${username}');`;
  const followers = await db.all(userFollowers);
  response.send(followers);
});

//

const getTweetIdResult = async (tweetId, username) => {
  const userFollowingPeopleTweetIds = `
    SELECT 
        tweet.tweet_id
    FROM 
        user INNER JOIN tweet ON user.user_id = tweet.user_id 
    WHERE
        tweet.user_id IN 
        (SELECT 
            follower.following_user_id
        FROM 
            user INNER JOIN follower ON user.user_id = follower.follower_user_id
        WHERE 
            username = '${username}');`;
  const tweetIds = await db.all(userFollowingPeopleTweetIds);
  let tweetIdValid = false;
  for (id of tweetIds) {
    if (parseInt(tweetId) === id.tweet_id) {
      tweetIdValid = true;
    }
  }
  return tweetIdValid;
};

//API6

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const { username } = request;
  const tweetResult = await getTweetIdResult(tweetId, username);
  if (tweetResult === true) {
    const tweetData = `
          SELECT
              tweet,
              (SELECT
                  COUNT()
               FROM
                  like
               WHERE
                  tweet_id = ${tweetId}) as likes,
              (SELECT
                  COUNT()
               FROM
                  reply
               WHERE
                  tweet_id = ${tweetId}) as replies,
              date_time as dateTime
          FROM
              tweet
          WHERE
              tweet_id = ${tweetId};`;
    const data = await db.get(tweetData);
    response.send(data);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

//API7
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const validTweetId = await getTweetIdResult(tweetId, username);
    if (validTweetId === true) {
      const getLikedPeopleNames = `
            SELECT 
                username 
            FROM 
                user
            WHERE 
                user_id IN (
                    SELECT 
                        user_id
                    FROM 
                        like
                    WHERE
                        tweet_id = ${tweetId}
                );`;
      const likedUserNames = await db.all(getLikedPeopleNames);
      let namesList = [];
      for (name of likedUserNames) {
        namesList.push(name.username);
      }
      response.send({ likes: namesList });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//API8

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const validIdTweet = await getTweetIdResult(tweetId, username);
    if (validIdTweet === true) {
      const getRepliedPeopleNames = `
            SELECT 
                user.name,
                reply.reply
            FROM 
                user INNER JOIN reply 
                ON user.user_id = reply.user_id
            WHERE 
                reply.tweet_id = ${tweetId};`;
      const repliedUsers = await db.all(getRepliedPeopleNames);
      let nameAndReplyArray = [];
      for (item of repliedUsers) {
        nameAndReplyArray.push(item);
      }
      response.send({ replies: nameAndReplyArray });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//API9

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserTweets = `
        SELECT 
            tweet.tweet,
            tweet.date_time as dateTime
        FROM
            user INNER JOIN tweet ON user.user_id = tweet.user_id
        WHERE
            user.username = '${username}';`;
  const userTweets = await db.all(getUserTweets);
  response.send(userTweets);
});

//API10

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const { username } = request;
  const getUserId = `
        SELECT 
            user_id
        FROM 
            user 
        WHERE
            username = '${username}';`;
  const userData = await db.get(getUserId);
  const userId = userData.user_id;

  let date_ob = new Date();
  let date = ("0" + date_ob.getDate()).slice(-2);
  let month = ("0" + (date_ob.getMonth() + 1)).slice(-2);
  let year = date_ob.getFullYear();
  let hours = date_ob.getHours();
  let minutes = date_ob.getMinutes();
  let seconds = date_ob.getSeconds();
  let dateAndTime = `${year}-${month}-${date} ${hours}:${minutes}:${seconds}`;

  const postTweet = `
      INSERT INTO
          tweet (tweet, user_id, date_time)
      VALUES
          ('${tweet}', ${userId}, '${dateAndTime}');`;
  await db.run(postTweet);
  response.send("Created a Tweet");
});

//API11

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const userTweetIds = `
        SELECT 
            tweet.tweet_id
        FROM
            user INNER JOIN tweet ON user.user_id = tweet.user_id
        WHERE
            user.username = '${username}';`;
    const getUserTweetIds = await db.all(userTweetIds);
    idTweet = false;
    for (id of getUserTweetIds) {
      if (parseInt(tweetId) === id.tweet_id) {
        idTweet = true;
      }
    }
    if (idTweet === true) {
      const deleteTweet = `
            DELETE FROM
                tweet
            WHERE
                tweet_id = ${tweetId};`;
      await db.run(deleteTweet);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
