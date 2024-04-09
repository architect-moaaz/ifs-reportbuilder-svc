## Dockerizing ifs -reportbuilder-svc
 Step 1: Create the Dockerfile 
  --- 
     command used: touch Dockerfile
   ---- 
 step 2: Build the docker image.
   ---
    docker build -t intelliflow/ifs-report-builder --build-arg PROFILE=colo .
   ---
   step 3: Run the docker image.
   ----
    docker run -p 31702:31702 intelliflow/ifs-report-builder 
   ---
     The above command starts the report builder image inside the container and exposes port 31702 inside container to port 31702 outside the container.
     ----

   step 4: Check the image created 
   ---
    docker images
   ---
 step 5:Access the route on server using http://localhost:31702

