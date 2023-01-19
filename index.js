const mongo = require("mongodb").MongoClient;
const http = require("http");
const fs = require("fs");

const express = require("express");

const app = express();
app.use(express.static("public"));
app.use(express.urlencoded({
    extended: true
}));
app.use(express.json({limit: "5mb"}));

class User {
    constructor(username, password, pfp, description) {
        this.type = "user";
        this.uid = null;
        this.username = username;
        this.password = password;
        //base64 encode of the image for storage
        this.pfp = pfp;
        this.description = description;

        //list of PIDs to display on profile
        this.likedPosts = [];
        
        //UIDs of followers and following
        this.followers = [];
        this.following = [];
      }

    setUid(uid) {
        this.uid = uid;
    }
}

class Post {
    constructor(text) {
        this.type = "post";
        this.pid = null;
        this.likes = 0;
        //list of other PIDs
        this.comments = [];
        this.text = text;

        let dateEnv = new Date();
        this.date = dateEnv.toLocaleDateString() + " " + (dateEnv.toTimeString().substring(0, dateEnv.toTimeString().indexOf(" ")));
    }
}

//connect to database
mongo.connect("mongodb://localhost:27017/2fast", function(err, db) {
    if(err)
            console.log(err.message);

    var userCol = db.db("2fast").collection("users");
    var postCol = db.db("2fast").collection("posts");

    //return "true" or "false" depending on if the given username is available or not
    function usernameAvailable(name)
    {
        //search for existing user with the given name
        return userCol.find({username: name});
    }

    function nextUid() {
        //sort by descending uid
        let sort = {uid: -1};

        //get the most recent user
        return userCol.find().sort(sort).limit(1);
    }

    function lastPid() {
        //sort by descending pid
        let sort = {pid: -1};

        return postCol.find().sort(sort).limit(1);
    }

    function signIn(username, password) {
        return userCol.find({username: username, password: password});
    }

    async function postChunk(chunk)
    {
       let last = await lastPid().next().then(function(value) {
        return value.pid;
       });

       //gather posts in groups of 12   - bounds are exclusive so we add and subtract 1
       //higher PID bounds
       let lt = (last - (chunk * 12) + 1) < 0 ? 0 : last - (chunk * 12) + 1;
       //lower PID bounds
       let gt = (lt - 13) < 0 ? -1 : lt - 13;
       
       console.log("Retreiving posts in bounds " + gt + " - " + lt);

       return postCol.find({pid: {$gt: gt, $lt: lt}});
    }

    //redirect with ".html" at the end is ugly; preferring manual file slinging here
    //matches all usernames, data will be filled in for specific user with post request
    app.get("/profile/*", function(req, res) {
        fs.readFile("./public/profile.html", function(err, data) {
            if(err)
                console.log(err);
            
            res.write(data);
            res.end();
        });
    });

    //serve 404 page if no other patterns can be matched
    app.get("*", function(req, res) {
        res.status(404);
        
        fs.readFile("./public/oops.html", function(err, data) {
            if(err)
                console.log(err);

            res.write(data);
            res.end();
        })
    });

    app.post("/index.js", async function(req, res) {
        console.log("POSTing data to: " + req.socket.remoteAddress);
        
        //parse all requests by "type" property
        switch(req.body.type)
        {
            case "post":
                //client is making a post
                break;
            case "display":
                //client needs posts to display

                let range = req.body.visits;
                let out = [];

                //place 12 posts (selected based on # of visits to server) into array
                postChunk(range).then(function(cursor) {
                    cursor.forEach(function(value) {
                        out.push(value);
                    }).then(function(value) {
                        //write arr back when all posts have been gathered into the array
                        res.write(JSON.stringify(out));
                        res.end();
                    });
                });

                break;
            case "user":
                //client is making a profile
                
                //wait to see if the username is taken
                let avail = await usernameAvailable(req.body.username).next().then(function(value) { 
                    return value === null ? true : false;
                });
                
                //username is available, make user in database
                if(avail)
                {
                    //TODO: hash password
                    let user = new User(req.body.username, req.body.password, req.body.pfp, req.body.description);
                    
                    //set the UID of the new user to be that of the last user + 1
                    user.setUid(await nextUid().next().then(function(value) {
                        return value.uid + 1;
                    }));

                    //TODO: put user in database
                    userCol.insertOne(user, function(err, res) {
                        if(err)
                            console.log(err);
                        else
                            console.log("User " + user.username + " created successfully!");
                    });

                    res.write(JSON.stringify(user));
                    res.end();
                } else {
                    //username is taken, let the client know
                    res.write("false");
                    res.end();
                }
                break;
            case "password":
                //someone is signing in
                let username = req.body.username;
                let password = req.body.password;
                
                let resp = await signIn(username, password).next().then(function(value) {
                    value.password = null;
                    return value === null ? "false" : JSON.stringify(value);
                });
                
                console.log(resp == "false" ? "Unsuccessful login attempt from user " + username : "Successful login from user " + username);

                
                res.write(resp);
                res.end();
                break;
            case "profile":
                let name = req.body.name;
                console.log("Serving profile of user: " + name);

                //reuse usernameAvailable to retrieve data from a user based on their username
                //return false if they requested a nonexistent user
                let profile = await usernameAvailable(name).next().then(function(value) {
                    return value == null ? false : value;
                });
                
                profile.password = null;

                //change to user
                res.write((typeof profile == "boolean" ? "false" : JSON.stringify(profile)));
                res.end();
                break;
        }
    });
    
    console.log("Starting web server...");
    app.listen(80);
});


